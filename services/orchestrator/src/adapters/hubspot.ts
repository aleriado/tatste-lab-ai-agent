import { Customer } from '@taste-labs/db';
import { Intent } from '@taste-labs/shared';
import { upsertCrmLink } from '@taste-labs/db';
import { logInfo, logError } from '../logger';

const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

interface HubspotResult {
  contactId?: string;
  dealId?: string;
}

export async function syncHubspotForIntent(params: {
  customer: Customer;
  intent: Intent;
}): Promise<HubspotResult | null> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;

  if (!token) {
    logInfo('HubSpot token not configured; running in stub mode', {
      customerId: params.customer.id,
      intent: params.intent
    });
    return null;
  }

  try {
    const contactId = await upsertContact(token, params.customer);
    const dealId = await createOrUpdateDeal(token, contactId, params.intent);

    await upsertCrmLink({
      customerId: params.customer.id,
      hubspotContactId: contactId,
      hubspotDealId: dealId,
      dealPipelineId: process.env.HUBSPOT_PIPELINE_ID ?? null,
      dealStageId: process.env.HUBSPOT_STAGE_ID ?? null,
      meta: {
        lastIntent: params.intent,
        syncedAt: new Date().toISOString()
      }
    });

    return { contactId, dealId };
  } catch (err) {
    logError('Error syncing with HubSpot', err);
    return null;
  }
}

async function upsertContact(token: string, customer: Customer): Promise<string> {
  const body: any = {
    properties: {
      ...(customer.email ? { email: customer.email } : {}),
      ...(customer.phone ? { phone: customer.phone } : {})
    }
  };

  const res = await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/contacts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot contact upsert failed: ${res.status} ${text}`);
  }

  const json: any = await res.json();
  return json.id as string;
}

async function createOrUpdateDeal(
  token: string,
  contactId: string,
  intent: Intent
): Promise<string> {
  const body: any = {
    properties: {
      dealname: `Taste Labs – ${intent}`,
      pipeline: process.env.HUBSPOT_PIPELINE_ID ?? undefined,
      dealstage: process.env.HUBSPOT_STAGE_ID ?? undefined
    },
    associations: [
      {
        to: { id: contactId },
        types: [
          {
            associationCategory: 'HUBSPOT_DEFINED',
            associationTypeId: 3 // Contact to Deal
          }
        ]
      }
    ]
  };

  const res = await fetch(`${HUBSPOT_BASE_URL}/crm/v3/objects/deals`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal create failed: ${res.status} ${text}`);
  }

  const json: any = await res.json();
  return json.id as string;
}

