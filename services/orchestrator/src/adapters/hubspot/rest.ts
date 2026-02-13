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
import { logInfo, logError } from '../../logger';

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
  const mode = 'rest';
  const hasToken = !!process.env.HUBSPOT_ACCESS_TOKEN;

  return {
    async upsertContact(input: UpsertContactInput): Promise<UpsertContactResult> {
      const token = getToken();
      const traceId = `hs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      
      logInfo('HubSpot REST upsertContact', {
        traceId,
        mode,
        hasToken,
        hasEmail: !!input.email,
        hasPhone: !!input.phone,
        hasExternalId: !!input.externalId,
        baseUrl
      });

      const properties: Record<string, string> = {};
      if (input.email) properties.email = input.email;
      if (input.phone) properties.phone = input.phone;

      // If we have email, use batch/upsert endpoint
      if (input.email && Object.keys(properties).length > 0) {
        logInfo('HubSpot REST upsertContact: using batch/upsert', { traceId, email: '[REDACTED]' });
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
            traceId,
            status: res.status,
            statusText: res.statusText,
            body: text
          });
          throw new Error(`HubSpot contact failed: ${res.status} ${text}`);
        }
        const json = (await res.json()) as { results?: Array<{ id: string }> };
        const id = json.results?.[0]?.id;
        if (!id) {
          throw new Error('HubSpot batch upsert did not return contact id');
        }
        logInfo('HubSpot REST upsertContact success (batch/upsert)', { traceId, contactId: id });
        return { contactId: id };
      }

      // Fallback: create contact without email/phone using externalId
      // HubSpot requires at least one of: email, firstname+lastname
      if (!properties.email && !properties.phone) {
        if (input.externalId) {
          // Create contact with firstname/lastname only (no email)
          // HubSpot allows this - we'll use externalId in the contact name for identification
          // Generate a short hash from externalId for the lastname to make it unique
          const base64 = Buffer.from(input.externalId).toString('base64');
          const hash = base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '')
            .slice(0, 8); // Short hash for lastname
          properties.firstname = 'TasteLabs';
          properties.lastname = `User-${hash}`;
          logInfo('HubSpot REST upsertContact: creating contact without email (firstname/lastname only)', {
            traceId,
            externalId: input.externalId,
            firstname: properties.firstname,
            lastname: properties.lastname
          });
        } else {
          throw new Error(
            'HubSpot contact requires at least one of: email, phone, or externalId'
          );
        }
      }

      // Ensure we have firstname/lastname if no email
      if (!properties.email && !properties.firstname) {
        properties.firstname = properties.firstname || 'TasteLabs';
        properties.lastname = properties.lastname || 'User';
      }

      logInfo('HubSpot REST upsertContact: using create endpoint', { traceId });
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
          traceId,
          status: res.status,
          statusText: res.statusText,
          body: text
        });
        throw new Error(`HubSpot contact failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as { id: string };
      logInfo('HubSpot REST upsertContact success (create)', { traceId, contactId: json.id });
      return { contactId: json.id };
    },

    async createOrUpdateDeal(
      input: CreateOrUpdateDealInput
    ): Promise<CreateOrUpdateDealResult> {
      const token = getToken();
      const traceId = `hs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      
      logInfo('HubSpot REST createOrUpdateDeal', {
        traceId,
        mode,
        hasToken,
        contactId: input.contactId,
        title: input.title,
        hasMeta: !!input.meta
      });

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
          traceId,
          status: res.status,
          statusText: res.statusText,
          body: text,
          requestBody: JSON.stringify(body)
        });
        throw new Error(`HubSpot deal failed: ${res.status} ${text}`);
      }
      const json = (await res.json()) as { id: string };
      const dealId = json.id;
      const cartItemsCount = input.meta ? (input.meta as any).cartItems?.length || 0 : 0;
      logInfo('HubSpot REST createOrUpdateDeal success', {
        traceId,
        dealId,
        cartItemsCount
      });

      // Create a HubSpot cart object and associate it with the deal
      // This uses HubSpot's native cart feature for better visibility
      if (input.meta && cartItemsCount > 0) {
        try {
          const meta = input.meta as any;
          const cartItems = meta.cartItems || [];
          const lastIntent = meta.lastIntent || 'UNKNOWN';
          
          // Calculate total (if prices available)
          const totalPrice = cartItems.reduce((sum: number, item: any) => {
            const price = parseFloat(item.price || '0');
            return sum + (isNaN(price) ? 0 : price);
          }, 0);
          
          // Simple cart name without item details
          const cartName = 'Taste Labs Cart';

          // Create cart object in HubSpot (without associations first)
          const cartRes = await fetch(`${baseUrl}/crm/v3/objects/carts`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              properties: {
                hs_cart_name: cartName,
                ...(totalPrice > 0 && { hs_total_price: totalPrice.toString() })
                // Note: hs_cart_status is not a standard property - cart status is managed by HubSpot
              }
            })
          });

          if (cartRes.ok) {
            const cartJson = (await cartRes.json()) as { id: string };
            const cartId = cartJson.id;
            
            // Associate cart with deal and contact using batch associations API
            // This is more reliable than individual PUT requests
            const associationsRes = await fetch(
              `${baseUrl}/crm/v3/associations/deal/cart/batch/create`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  inputs: [
                    {
                      from: { id: dealId },
                      to: { id: cartId },
                      type: 'deal_to_cart'
                    }
                  ]
                })
              }
            );

            const contactAssocRes = await fetch(
              `${baseUrl}/crm/v3/associations/contact/cart/batch/create`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  inputs: [
                    {
                      from: { id: input.contactId },
                      to: { id: cartId },
                      type: 'contact_to_cart'
                    }
                  ]
                })
              }
            );

            if (associationsRes.ok && contactAssocRes.ok) {
              logInfo('HubSpot cart created and associated with deal and contact', {
                traceId,
                dealId,
                cartId,
                cartItemsCount,
                cartName
              });
            } else {
              // Cart created but associations failed - log but don't fail
              const dealAssocText = await associationsRes.text().catch(() => '');
              const contactAssocText = await contactAssocRes.text().catch(() => '');
              logError('HubSpot cart created but associations failed (non-blocking)', {
                traceId,
                dealId,
                cartId,
                dealAssociationStatus: associationsRes.status,
                dealAssociationBody: dealAssocText,
                contactAssociationStatus: contactAssocRes.status,
                contactAssociationBody: contactAssocText
              });
            }
          } else {
            // Log but don't fail - cart creation is optional enhancement
            // Cart info is already visible in deal name as fallback
            const cartText = await cartRes.text();
            const isScopeError = cartRes.status === 403 && cartText.includes('MISSING_SCOPES');
            logError('HubSpot cart creation failed (non-blocking)', {
              traceId,
              dealId,
              status: cartRes.status,
              isScopeError,
              message: isScopeError 
                ? 'Missing crm.schemas.carts.write scope - cart info visible in deal name instead'
                : 'Cart creation failed - cart info visible in deal name instead',
              body: cartText
            });
          }
        } catch (cartErr) {
          // Log but don't fail - cart creation is optional enhancement
          logError('HubSpot cart creation error (non-blocking)', {
            traceId,
            dealId,
            error: cartErr instanceof Error ? cartErr.message : String(cartErr)
          });
        }
      }

      return { dealId };
    }
  };
}
