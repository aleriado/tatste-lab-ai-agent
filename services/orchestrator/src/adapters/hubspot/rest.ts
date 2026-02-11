/**
 * HubSpot REST adapter — uses HUBSPOT_ACCESS_TOKEN.
 * Minimal upsert contact + create/update deal.
 */

import type {
  HubSpotAdapter,
  UpsertContactInput,
  UpsertContactResult,
  CreateOrUpdateDealInput,
  CreateOrUpdateDealResult
} from './types';
import { logError } from '../../logger';

const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

function getToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error('HUBSPOT_ACCESS_TOKEN is not set');
  return token;
}

export function createRestHubSpotAdapter(): HubSpotAdapter {
  return {
    async upsertContact(input: UpsertContactInput): Promise<UpsertContactResult> {
      const token = getToken();
      const body: any = {
        properties: {
          ...(input.email ? { email: input.email } : {}),
          ...(input.phone ? { phone: input.phone } : {})
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
        logError('HubSpot REST upsertContact failed', { status: res.status, text });
        throw new Error(`HubSpot contact failed: ${res.status} ${text}`);
      }
      const json: any = await res.json();
      return { contactId: json.id };
    },

    async createOrUpdateDeal(input: CreateOrUpdateDealInput): Promise<CreateOrUpdateDealResult> {
      const token = getToken();
      const body: any = {
        properties: {
          dealname: input.title,
          pipeline: process.env.HUBSPOT_PIPELINE_ID ?? undefined,
          dealstage: process.env.HUBSPOT_STAGE_ID ?? input.stage ?? undefined
        },
        associations: [
          {
            to: { id: input.contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
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
        logError('HubSpot REST createOrUpdateDeal failed', { status: res.status, text });
        throw new Error(`HubSpot deal failed: ${res.status} ${text}`);
      }
      const json: any = await res.json();
      return { dealId: json.id };
    }
  };
}
