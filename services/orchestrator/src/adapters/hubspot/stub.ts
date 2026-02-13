/**
 * HubSpot stub adapter — logs intended actions, returns fake IDs.
 * Keeps demo working and CrmLink populated with fake ids when REST/MCP not configured.
 */

import type { HubSpotAdapter, UpsertContactResult, CreateOrUpdateDealResult } from './types';
import { logInfo } from '../../logger';

function fakeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const stubHubSpotAdapter: HubSpotAdapter = {
  async upsertContact(input): Promise<UpsertContactResult> {
    logInfo('HubSpot stub: upsertContact', input);
    return { contactId: fakeId('stub_contact') };
  },

  async createOrUpdateDeal(input): Promise<CreateOrUpdateDealResult> {
    logInfo('HubSpot stub: createOrUpdateDeal', {
      contactId: input.contactId,
      title: input.title,
      stage: input.stage
    });
    return { dealId: fakeId('stub_deal') };
  }
};
