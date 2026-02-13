/**
 * HubSpot adapter selector and sync helper for orchestrator.
 * INTEGRATION_MODE_HUBSPOT = mcp | rest | stub
 * - rest + HUBSPOT_ACCESS_TOKEN → rest
 * - mcp → mcp (test mode); if not configured, fall back to stub
 * - stub or missing creds → stub
 */

import type { Customer } from '@taste-labs/db';
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
}): Promise<{ contactId: string; dealId: string } | null> {
  try {
    if (!params.customer.email && !params.customer.phone) {
      logInfo('HubSpot sync skipped: no customer email or phone');
      return null;
    }
    const adapter = getHubSpotAdapter();
    const contactResult = await adapter.upsertContact({
      email: params.customer.email ?? undefined,
      phone: params.customer.phone ?? undefined,
      externalId: params.customer.id
    });
    const dealResult = await adapter.createOrUpdateDeal({
      contactId: contactResult.contactId,
      title: `Taste Labs – ${params.intent}`,
      stage: process.env.HUBSPOT_STAGE_ID ?? undefined,
      meta: { lastIntent: params.intent }
    });

    await upsertCrmLink({
      customerId: params.customer.id,
      hubspotContactId: contactResult.contactId,
      hubspotDealId: dealResult.dealId,
      dealPipelineId: process.env.HUBSPOT_PIPELINE_ID ?? null,
      dealStageId: process.env.HUBSPOT_STAGE_ID ?? null,
      meta: {
        lastIntent: params.intent,
        syncedAt: new Date().toISOString()
      }
    });

    return { contactId: contactResult.contactId, dealId: dealResult.dealId };
  } catch (err) {
    logError('HubSpot sync failed', err);
    return null;
  }
}
