# Taste Labs AI Concierge — Project Description

## Overview

**Taste Labs AI Concierge** is a PNPM monorepo that implements a **conversational AI concierge** for customer interactions. It acts as the central orchestration layer that normalizes messages from multiple channels, resolves identity, classifies intent, runs flows (recommend, add-to-cart, checkout, etc.), and syncs data with **HubSpot** (CRM) and **WooCommerce** (e-commerce).

The system is designed to be **channel-agnostic**: the same pipeline handles web chat, WhatsApp, or Telegram by normalizing inbound payloads into a standard shape before processing.

---

## Architecture

### Monorepo Structure

| Path | Purpose |
|------|---------|
| **apps/web** | Next.js 14 chat UI — client-facing conversational interface |
| **services/orchestrator** | Express backend — message handling, intent routing, flows, integrations |
| **packages/db** | Prisma client + DB helpers (resolveCustomer, threads, messages, CrmLink) |
| **packages/shared** | Shared TypeScript types (Intent, InboundMessagePayload, OrchestratorReply) |
| **prisma/** | Schema and migrations for PostgreSQL (e.g. Supabase) |

### Request Flow (High Level)

1. **Inbound** — User sends a message from a channel (e.g. web chat).
2. **Normalize** — Payload is validated (Zod) into `channel`, `channel_user_id`, `text`, optional `email`/`phone`.
3. **Identity** — `resolveCustomer(channel, channel_user_id, …)` upserts `Customer` and `ChannelIdentity`.
4. **Session** — `getOrCreateForegroundThread(customerId)` returns the active conversation thread.
5. **Persistence** — Inbound message is stored in `Message` with `traceId`.
6. **Intent** — `classifyIntent(text)` returns one of: `RECOMMEND`, `ADD_TO_CART`, `CHECKOUT_INTENT`, `JOIN_GROUP_ORDER`.
7. **Flow** — A flow handler runs (e.g. `runRecommendFlow`, `runAddToCartFlow`) and returns reply text + context patch.
8. **Context** — `updateThreadContext(threadId, { …contextPatch, last_intent })` updates `Thread.contextJson`.
9. **Outbound** — Reply is saved as an outbound `Message` and returned to the client.
10. **HubSpot** — For `RECOMMEND` and `ADD_TO_CART`, `syncHubspotForIntent` upserts contact, creates deal (and optionally a HubSpot cart), and persists IDs in `CrmLink`.

---

## Core Components

### Orchestrator (`services/orchestrator`)

- **Entrypoint**: Express app in `src/index.ts`; main endpoint is `POST /api/message`.
- **Intent classifier** (`src/intent/classifier.ts`): Rule-based; keywords like "add 1", "checkout", "group order" / "join" map to intents; default is `RECOMMEND`.
- **Flows** (`src/flows/`):
  - **recommend** — Calls WooCommerce REST to search products; returns up to 10 items and stores `last_recommendations` in thread context.
  - **addToCart** — Parses "add N", picks item from `last_recommendations`, appends to `thread.contextJson.cart`.
  - **checkout** — Returns a mock checkout URL and updates context with `checkout_url`, `step: awaiting_payment`.
  - **joinGroupOrder** — Stub for M2; returns a placeholder message.
- **Adapters**:
  - **HubSpot** (`adapters/hubspot/`): REST adapter creates/updates contacts (with fallback for anonymous users), creates deals, optionally creates HubSpot cart and associates it with deal/contact. Modes: `rest`, `mcp`, `stub` (env-driven).
  - **WooCommerce** (`adapters/woocommerce/`): REST adapter for product search; modes: `rest`, `mcp`, `mock`.

### Database (`packages/db` + Prisma)

- **Customer** — Canonical identity; optional email/phone; `foregroundThreadId` for active thread.
- **ChannelIdentity** — Maps `(channel, channelUserId)` to a `Customer` for multi-channel continuity.
- **Thread** — Conversation container; `contextJson` holds `last_intent`, `last_recommendations`, `cart`, `step`, etc.
- **Message** — All inbound/outbound messages with `traceId` for auditing.
- **CrmLink** — Stores HubSpot `contactId`, `dealId`, and meta (e.g. cart summary) per customer.
- **CommerceLink** — Placeholder for WooCommerce customer/order mapping.

### Frontend (`apps/web`)

- Single chat page (`app/page.tsx`) that:
  - Maintains a stable `channel_user_id` in localStorage (`web_…`).
  - Sends `POST` to `NEXT_PUBLIC_ORCHESTRATOR_URL/api/message` with `{ channel, channel_user_id, text }`.
  - Displays bot replies and supports intents: RECOMMEND, ADD_TO_CART, CHECKOUT_INTENT, JOIN_GROUP_ORDER.

---

## Integrations

### HubSpot (CRM)

- **Contact**: Upserted by email/phone when present; otherwise created with firstname/lastname (e.g. "TasteLabs", "User-{hash}") for anonymous users.
- **Deal**: Created per RECOMMEND/ADD_TO_CART with title like "Taste Labs Order Intent - ADD_TO_CART", associated to contact.
- **Cart** (optional): If scopes allow (`crm.objects.carts.write`, `crm.schemas.carts.write`), a HubSpot cart object is created and associated with the deal and contact; otherwise cart data lives only in DB and deal name stays clean.
- **CrmLink**: After sync, `hubspotContactId`, `hubspotDealId`, and meta are stored for the customer.

### WooCommerce

- **Catalog**: REST adapter searches products; results drive recommendations and are stored in thread context as `last_recommendations`.
- **Cart**: Stored in application state only (`Thread.contextJson.cart`), not in WooCommerce cart API for M1.

---

## Tech Stack

- **Runtime**: Node.js 18+
- **Package manager**: pnpm 9 (workspaces)
- **Frontend**: Next.js 14, React 18, TypeScript
- **Backend**: Express, TypeScript, ts-node-dev
- **Database**: PostgreSQL (Supabase), Prisma ORM
- **Validation**: Zod
- **Integrations**: HubSpot REST API, WooCommerce REST API

---

## Milestones

- **M0** — Docs & foundations: done.
- **M1** — Core concierge demo: done (recommend → add-to-cart → checkout intent; HubSpot contact/deal/cart sync; session persistence).
- **M2** — Group order lifecycle + payments: planned.
- **M3** — Multi-channel (WhatsApp, Telegram, etc.): planned.

---

## How to Run

- **Install**: `pnpm install` (runs `prisma generate` via postinstall).
- **Database**: Set `DATABASE_URL` in `.env`; run `pnpm db:migrate`.
- **Dev**: `pnpm dev` — starts Next.js on port 3000 and orchestrator on port 4000.
- **Demo**: See [M1_demo_script.md](./M1_demo_script.md) for step-by-step recommend → add-to-cart → checkout and HubSpot verification.

---

## Summary

Taste Labs AI Concierge is a **conversation orchestration backend** plus **web chat UI** that ties together identity, session (thread) state, intent-based flows, and integrations with HubSpot and WooCommerce. It is built for extensibility (new intents, flows, channels, and adapters) while keeping the pipeline consistent: normalize → resolve customer → get/create thread → save message → classify intent → run flow → update context → sync CRM → return reply.
