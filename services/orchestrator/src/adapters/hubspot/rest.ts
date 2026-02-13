/**
 * HubSpot REST adapter — uses HUBSPOT_ACCESS_TOKEN.
 * Supports EU accounts via HUBSPOT_BASE_URL or auto-detect from token prefix (eu1-).
 * Upserts contact by email when possible; creates deal and associates to contact.
 */

import type {
  HubSpotAdapter,
  UpsertContactInput,
  UpsertContactResult,
  CreateOrUpdateDealInput,
  CreateOrUpdateDealResult
} from './types';
import { logError } from '../../logger';

const HUBSPOT_US_BASE = 'https://api.hubapi.com';
const HUBSPOT_EU_BASE = 'https://api-eu1.hubapi.com';

function getToken(): string {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    throw new Error('HUBSPOT_ACCESS_TOKEN is not set');
  }
  return token;
}

function getBaseUrl(): string {
  const envUrl = process.env.HUBSPOT_BASE_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  const token = getToken();
  if (token.startsWith('eu1-')) return HUBSPOT_EU_BASE;
  return HUBSPOT_US_BASE;
}

export function createRestHubSpotAdapter(): HubSpotAdapter {
  const baseUrl = getBaseUrl();

  return {
    async upsertContact(input: UpsertContactInput): Promise<UpsertContactResult> {
      const token = getToken();
      const properties: Record<string, string> = {};
      if (input.email) properties.email = input.email;
      if (input.phone) properties.phone = input.phone;

      if (input.email && Object.keys(properties).length > 0) {
        const res = await fetch(
          `${baseUrl}/crm/v3/objects/contacts/batch/upsert`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              idProperty: 'email',
              inputs: [{ id: input.email, properties }]
            })
          }
        );
        if (!res.ok) {
          const text = await res.text();
          logError('HubSpot REST upsertContact (batch/upsert) failed', {
            status: res.status,
            text
          });
          throw new Error(`HubSpot contact failed: ${res.status} ${text}`);
        }
        const json = (await res.json()) as { results?: Array<{ id: string }> };
        const id = json.results?.[0]?.id;
        if (!id) {
          throw new Error('HubSpot batch upsert did not return contact id');
        }
        return { contactId: id };
      }

      if (Object.keys(properties).length === 0) {
        throw new Error(
          'HubSpot contact requires at least one of: email, phone (or firstname/lastname)'
        );
      }
      // HubSpot requires at least one of email, firstname, lastname
      if (!properties.email) properties.firstname = properties.firstname || 'Contact';
      const createBody = { properties };
      const res = await fetch(`${baseUrl}/crm/v3/objects/contacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(createBody)
      });
      if (!res.ok) {
        const text = await res.text();
        logError('HubSpot REST upsertContact (create) failed', {
          status: res.status,
          text
        });
        throw new Error(`HubSpot contact failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as { id: string };
      return { contactId: json.id };
    },

    async createOrUpdateDeal(
      input: CreateOrUpdateDealInput
    ): Promise<CreateOrUpdateDealResult> {
      const token = getToken();
      const body: Record<string, unknown> = {
        properties: {
          dealname: input.title,
          ...(process.env.HUBSPOT_PIPELINE_ID && {
            pipeline: process.env.HUBSPOT_PIPELINE_ID
          }),
          ...(process.env.HUBSPOT_STAGE_ID && {
            dealstage: process.env.HUBSPOT_STAGE_ID
          }),
          ...(input.stage && !process.env.HUBSPOT_STAGE_ID && {
            dealstage: input.stage
          })
        },
        associations: [
          {
            to: { id: input.contactId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
          }
        ]
      };
      const res = await fetch(`${baseUrl}/crm/v3/objects/deals`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        logError('HubSpot REST createOrUpdateDeal failed', {
          status: res.status,
          text
        });
        throw new Error(`HubSpot deal failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as { id: string };
      return { dealId: json.id };
    }
  };
}
