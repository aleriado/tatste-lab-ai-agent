/**
 * HubSpot MCP adapter (test mode). Minimal implementation.
 * If not configured, falls back to stub.
 */

import type {
  HubSpotAdapter,
  UpsertContactInput,
  UpsertContactResult,
  CreateOrUpdateDealInput,
  CreateOrUpdateDealResult
} from './types';
import { logInfo, logError } from '../../logger';
import { stubHubSpotAdapter } from './stub';

// TODO: When HubSpot MCP endpoint is defined, call it here (e.g. via a shared MCP client for HubSpot).
// For now we log and use stub so flows never break.

export function createMcpHubSpotAdapter(): HubSpotAdapter {
  const baseUrl = process.env.MCP_HUBSPOT_BASE_URL;
  if (!baseUrl) {
    logInfo('HubSpot MCP: MCP_HUBSPOT_BASE_URL not set; using stub');
    return stubHubSpotAdapter;
  }

  return {
    async upsertContact(input: UpsertContactInput): Promise<UpsertContactResult> {
      try {
        // TODO: Call HubSpot MCP tool/endpoint for upsert contact
        logInfo('HubSpot MCP (test mode): upsertContact not implemented', input);
        return stubHubSpotAdapter.upsertContact(input);
      } catch (err) {
        logError('HubSpot MCP upsertContact failed; falling back to stub', err);
        return stubHubSpotAdapter.upsertContact(input);
      }
    },

    async createOrUpdateDeal(input: CreateOrUpdateDealInput): Promise<CreateOrUpdateDealResult> {
      try {
        // TODO: Call HubSpot MCP tool/endpoint for create/update deal
        logInfo('HubSpot MCP (test mode): createOrUpdateDeal not implemented', {
          contactId: input.contactId,
          title: input.title
        });
        return stubHubSpotAdapter.createOrUpdateDeal(input);
      } catch (err) {
        logError('HubSpot MCP createOrUpdateDeal failed; falling back to stub', err);
        return stubHubSpotAdapter.createOrUpdateDeal(input);
      }
    }
  };
}
