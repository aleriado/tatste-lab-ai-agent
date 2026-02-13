/**
 * Stable HubSpot adapter types. Flows/orchestrator depend only on these.
 */

export interface UpsertContactInput {
  email?: string;
  phone?: string;
  externalId?: string;
}

export interface UpsertContactResult {
  contactId: string;
}

export interface CreateOrUpdateDealInput {
  contactId: string;
  title: string;
  stage?: string;
  meta?: unknown;
}

export interface CreateOrUpdateDealResult {
  dealId: string;
}

export interface HubSpotAdapter {
  upsertContact(input: UpsertContactInput): Promise<UpsertContactResult>;
  createOrUpdateDeal(input: CreateOrUpdateDealInput): Promise<CreateOrUpdateDealResult>;
}
