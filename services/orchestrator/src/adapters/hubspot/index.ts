/**
 * HubSpot adapter selector and sync helper for orchestrator.
 * INTEGRATION_MODE_HUBSPOT = mcp | rest | stub
 * - rest + HUBSPOT_ACCESS_TOKEN → rest
 * - mcp → mcp (test mode); if not configured, fall back to stub
 * - stub or missing creds → stub
 */

import type { Customer, Thread } from '@taste-labs/db';
import type { Intent } from '@taste-labs/shared';
import { upsertCrmLink } from '@taste-labs/db';
import type { HubSpotAdapter } from './types';
import { stubHubSpotAdapter } from './stub';
import { createRestHubSpotAdapter } from './rest';
import { createMcpHubSpotAdapter } from './mcp';
import { logInfo, logError } from '../../logger';

let cached: HubSpotAdapter | null = null;

function getMode(): 'mcp' | 'rest' | 'stub' {
  const raw = process.env.INTEGRATION_MODE_HUBSPOT?.toLowerCase();
  if (raw === 'mcp' || raw === 'rest' || raw === 'stub') return raw;
  return 'stub';
}

export function getHubSpotAdapter(): HubSpotAdapter {
  if (cached) return cached;

  const mode = getMode();

  if (mode === 'rest' && process.env.HUBSPOT_ACCESS_TOKEN) {
    try {
      cached = createRestHubSpotAdapter();
      logInfo('HubSpot adapter: REST');
      return cached;
    } catch (e) {
      logInfo('HubSpot REST init failed; falling back to stub', e);
    }
  }

  if (mode === 'mcp') {
    try {
      cached = createMcpHubSpotAdapter();
      logInfo('HubSpot adapter: MCP (test mode)');
      return cached;
    } catch (e) {
      logInfo('HubSpot MCP failed; falling back to stub', e);
    }
  }

  cached = stubHubSpotAdapter;
  logInfo('HubSpot adapter: stub');
  return cached;
}

export type { HubSpotAdapter, UpsertContactInput, CreateOrUpdateDealInput } from './types';

/**
 * Sync HubSpot for RECOMMEND / ADD_TO_CART: upsert contact, create/update deal, store IDs in CrmLink.
 * Uses selected adapter (rest/mcp/stub). Never throws into flow — logs and returns null on failure.
 */
export async function syncHubspotForIntent(params: {
  customer: Customer;
  intent: Intent;
  thread: Thread;
  traceId: string;
}): Promise<{ contactId: string; dealId: string } | null> {
  const { customer, intent, thread, traceId } = params;
  
  try {
    const mode = getMode();
    const hasToken = !!process.env.HUBSPOT_ACCESS_TOKEN;
    
    logInfo('HubSpot sync started', {
      traceId,
      mode,
      hasToken,
      intent,
      customerId: customer.id,
      hasEmail: !!customer.email,
      hasPhone: !!customer.phone
    });

    const adapter = getHubSpotAdapter();
    
    // Extract cart items from thread context for deal meta
    const threadContext = (thread.contextJson as any) ?? {};
    const cartItems = threadContext.cart ?? [];
    
    // Upsert contact - use externalId fallback if no email/phone
    const contactInput: Parameters<typeof adapter.upsertContact>[0] = {
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      externalId: customer.id
    };
    
    logInfo('HubSpot upsertContact', { traceId, input: { ...contactInput, email: contactInput.email ? '[REDACTED]' : undefined } });
    const contactResult = await adapter.upsertContact(contactInput);
    logInfo('HubSpot upsertContact success', { traceId, contactId: contactResult.contactId });
    
    // Create/update deal with cart context
    const dealTitle = `Taste Labs Order Intent - ${intent}`;
    const dealMeta = {
      lastIntent: intent,
      cartItems: cartItems.map((item: any) => ({
        name: item.name,
        id: item.id
      })),
      syncedAt: new Date().toISOString()
    };
    
    logInfo('HubSpot createOrUpdateDeal', { traceId, contactId: contactResult.contactId, title: dealTitle });
    const dealResult = await adapter.createOrUpdateDeal({
      contactId: contactResult.contactId,
      title: dealTitle,
      stage: process.env.HUBSPOT_STAGE_ID ?? undefined,
      meta: dealMeta
    });
    logInfo('HubSpot createOrUpdateDeal success', { traceId, dealId: dealResult.dealId });

    // Persist HubSpot IDs to DB
    await upsertCrmLink({
      customerId: customer.id,
      hubspotContactId: contactResult.contactId,
      hubspotDealId: dealResult.dealId,
      dealPipelineId: process.env.HUBSPOT_PIPELINE_ID ?? null,
      dealStageId: process.env.HUBSPOT_STAGE_ID ?? null,
      meta: {
        lastIntent: intent,
        syncedAt: new Date().toISOString(),
        cartItems: cartItems.length
      }
    });

    logInfo('HubSpot sync completed', {
      traceId,
      contactId: contactResult.contactId,
      dealId: dealResult.dealId
    });

    return { contactId: contactResult.contactId, dealId: dealResult.dealId };
  } catch (err) {
    logError('HubSpot sync failed', {
      traceId,
      intent,
      customerId: customer.id,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return null;
  }
}
