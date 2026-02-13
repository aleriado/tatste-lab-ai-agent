## Taste Labs AI Concierge

**Taste Labs AI Concierge** is the **core orchestrator** for AI-powered customer interactions, plus integrations with key systems like **HubSpot** and **WooCommerce**.

This repository is intended to be the central brain that:
- **Normalizes inbound events** from various channels
- **Resolves identity / session**
- **Determines intent and next-best action**
- **Routes through flows and tools**
- **Emits events and sends outbound messages**

> **Note:** This README is a starting template based on the planned architecture. As you build out the repo, update each section with concrete details (tables, commands, env vars, etc.).

---

## 1. What this repo is

- **Taste Labs AI Concierge** — core orchestrator for AI-driven customer flows.
- **Integrations (M1)** — adapter-based, swappable:
  - **WooCommerce**: MCP adapter primary; fallback to REST or mock. Catalog (searchProducts, getProduct); cart in DB context.
  - **HubSpot**: MCP test mode + REST or stub fallback. Contact upsert + deal create/update.
  - **Payments**: pluggable adapter (placeholder for M2).
  - See [docs/integrations.md](docs/integrations.md) and **Integrations (M1)** below for env vars and modes.

---

## 2. Milestones status

- **M0 — Docs & Foundations**: ✅ **Done**
  - Project scope, high-level architecture, initial schemas and flows defined.
- **M1 — Core Concierge Demo**: ✅ **Complete**
  - End-to-end demo for a core AI concierge flow:
    - ✅ Express orchestrator with POST /api/message endpoint
    - ✅ Next.js chat UI integration
    - ✅ Prisma migrations applied to Supabase Postgres
    - ✅ Session persistence via Thread.contextJson
    - ✅ Intent routing (RECOMMEND, ADD_TO_CART, CHECKOUT_INTENT, JOIN_GROUP_ORDER)
    - ✅ HubSpot REST adapter with contact/deal sync
    - ✅ WooCommerce REST adapter for catalog search
    - ✅ Full flow: recommend → add-to-cart → HubSpot write
- **M2 — Group Order Lifecycle + Payments**: 📌 **Planned**
- **M3 — Multi-channel Integration**: 📌 **Planned**

> Keep this section up to date as milestones evolve.

---

## 3. Core orchestration structure

High-level pipeline for every interaction:

1. **Inbound**
   - Events/messages from channels (web, chat, email, etc.).
2. **Normalize**
   - Convert channel-specific payloads into a **standard internal event shape**.
3. **Identity / Session**
   - Resolve user identity and session:
     - Map external IDs (HubSpot contact, Woo user, etc.) to internal IDs.
     - Handle anonymous → known user transitions.
4. **Intent**
   - Use rules / ML / LLM to classify **intent** (e.g., browse menu, create group order, check order status).
5. **Flow**
   - Route into a **flow engine** or **state machine** representing the user journey.
6. **Tools**
   - Call tools / adapters:
     - HubSpot (read/write CRM data)
     - Woo (catalog/cart/order ops)
     - Payment adapter(s)
7. **Events**
   - Emit internal events for observability, analytics, and downstream systems.
8. **Outbound**
   - Render and send a response back to the channel (chat message, email, webhook, etc.).

As the implementation solidifies, add links here to:
- Core orchestrator modules
- Flow / state machine definitions
- Event contracts / schemas

---

## 4. DB schema & migrations

> **TODO:** Replace this section with the actual schema and tooling once implemented.

- **Tables (planned example list – adjust to match reality):**
  - **`users`**: canonical user identity (internal ID, external IDs, profile info).
  - **`sessions`**: active conversation / interaction sessions.
  - **`events`**: normalized inbound/outbound events for audit & analytics.
  - **`intents`**: detected intents and confidence scores.
  - **`flows` / `flow_states`**: current step/state in each user flow.
  - **`hubspot_links`**: mapping between internal IDs and HubSpot objects.
  - **`woo_links`**: mapping between internal IDs and WooCommerce customers/orders.
  - **`orders` / `order_items`**: concierge-driven orders and group orders.
  - **`payments`**: payment intents, statuses, and references to external PSPs.

- **Migrations:**
  - **Tooling**: _e.g._ Prisma / Knex / Flyway / Alembic / raw SQL (fill in once chosen).
  - **How to run locally:**
    - Example (adapt to your stack):

```bash
# Example – replace with real commands
cp .env.example .env   # make sure DB_URL is set
pnpm / npm / poetry / uv run db:migrate
```

  - **Seeding (optional):**
    - Provide seed data for demo flows (sample users, catalog, orders).

---

## 5. How to run locally

- **Prerequisites:** Node.js 18+, pnpm, Postgres (e.g. Supabase).

- **Env vars:** Copy `.env.example` to `.env` and set at least:
  - `DATABASE_URL` — Postgres connection string
  - `ORCHESTRATOR_URL` / `NEXT_PUBLIC_ORCHESTRATOR_URL` — e.g. `http://localhost:4000`
  - For integrations see **Integrations (M1)** below and [docs/integrations.md](docs/integrations.md).

- **Install and run:**

```bash
pnpm install  # This will automatically run `prisma generate` via postinstall script
pnpm db:migrate  # Apply database migrations
pnpm dev  # Start both Next.js and orchestrator services
```

**Note**: If Prisma client generation fails, run `pnpm db:generate` manually.

- **Result:** Next.js chat UI on `http://localhost:3000`, orchestrator on `http://localhost:4000`.

---

## 5.1 Integrations (M1)

Integration behavior is controlled by env flags. Flows use a **stable adapter interface** and do not depend on which backend (MCP, REST, or mock/stub) is active.

| Env var | Values | Description |
|--------|--------|-------------|
| `INTEGRATION_MODE_WOO` | `mcp` \| `rest` \| `mock` | WooCommerce adapter. Defaults to `mock` if MCP not configured. |
| `MCP_WP_BASE_URL` | URL | WordPress/Woo MCP service base URL (for `mcp` mode). |
| `MCP_WP_TOKEN` | string | Optional auth token for MCP. |
| `INTEGRATION_MODE_HUBSPOT` | `mcp` \| `rest` \| `stub` | HubSpot adapter. |
| `HUBSPOT_ACCESS_TOKEN` | string | Required for `rest`; optional for MCP. |
| `HUBSPOT_PIPELINE_ID` | string | Optional pipeline for new deals. |
| `HUBSPOT_STAGE_ID` | string | Optional stage for new deals. |

- **Woo:** MCP is primary for M1; `mock` keeps the recommend/add-to-cart demo working without Woo.
- **HubSpot:** MCP is test mode; `stub` logs actions and stores fake IDs in `CrmLink` so the demo never breaks.

Full details: [docs/integrations.md](docs/integrations.md).

---

## 6. Integrations

> **Note:** This describes the intended contract. Update with concrete method names + paths once adapters exist.

- **HubSpot adapter (CRM):**
  - **Read operations:**
    - Get contact by email / phone / external ID.
    - Fetch deals / tickets associated with a contact.
    - Read timelines / engagement history.
  - **Write operations:**
    - Create / update contact records.
    - Log events/notes on the contact timeline.
    - Create/update deals/tickets related to concierge interactions.

- **Woo adapter (Commerce):**
  - **Catalog:**
    - List products / menus.
    - Get product details, options, and availability.
  - **Cart:**
    - Create/update carts (including group carts).
    - Add/remove items, apply discount codes.
  - **Order:**
    - Create orders from finalized carts.
    - Fetch order status and history.

- **Payment adapter (placeholder):**
  - Abstraction over one or more payment providers.
  - Planned methods (example):
    - `createPaymentIntent(amount, currency, metadata)`
    - `confirmPayment(intentId, paymentMethod)`
    - `refundPayment(intentId, amount)`
  - Designed so different PSPs (Stripe, Adyen, etc.) can be swapped without changing flows.

---

## 7. Demo flow for Milestone 1

> **TODO:** Replace with the exact, reproducible steps for your M1 demo once it’s wired up.

Example structure (fill in details):

1. **Setup**
   - Start local services (API, DB, any UI).
   - Ensure seed data is loaded (sample restaurant, menu, user).
2. **Trigger**
   - From channel (e.g. web chat), send an initial message:
     - `"I want to place a group order for tonight"`
3. **Expected concierge flow**
   - Concierge asks clarifying questions (time, number of people, dietary prefs).
   - Shows menu items from Woo catalog.
   - Collects items into a **group cart**.
   - Confirms the order summary.
4. **Integrations involved**
   - **Woo**: catalog + cart + order creation.
   - **HubSpot**: log interaction to contact + create/update deal.
   - **(Future) Payments**: initiate payment intent for final order total.
5. **Verification**
   - Check DB tables for created session, events, order.
   - Check HubSpot for updated contact / deal.
   - Check WooCommerce for the created order.

---

## 8. Troubleshooting

### HubSpot sync issues

**Symptoms**: HubSpot writes not appearing in HubSpot UI or logs show errors.

**Common causes:**
- **401 Unauthorized**: `HUBSPOT_ACCESS_TOKEN` is invalid/expired
  - Solution: Regenerate token in HubSpot Settings → Private Apps
- **403 Forbidden**: Token lacks required scopes
  - **Required scopes for M1:**
    - `crm.objects.contacts.write` - Create/update contacts
    - `crm.objects.deals.write` - Create/update deals (or `crm.objects.deals.sensitive.write.v2`)
  - **How to fix:**
    1. Go to HubSpot → Settings → Integrations → Private Apps
    2. Find your private app (or create a new one)
    3. Under "Scopes", enable:
       - ✅ `crm.objects.contacts.write`
       - ✅ `crm.objects.deals.write` (or `crm.objects.deals.sensitive.write.v2`)
    4. Save and regenerate the access token
    5. Update `HUBSPOT_ACCESS_TOKEN` in your `.env` file
  - **Cart Information in HubSpot:**
    - **Preferred**: If you have `crm.objects.carts.write` AND `crm.schemas.carts.write` scopes, a HubSpot Cart object is created and associated with the deal (visible in "Carts" section).
    - **Fallback**: If cart creation fails (missing `crm.schemas.carts.write` scope), cart information is included in the deal name instead (e.g., "Taste Labs Order Intent - ADD_TO_CART (3 items: פסטה, עגבניות שלמות)").
    - **Always**: Full cart details are stored in your database's `CrmLink.meta` field regardless of HubSpot cart creation success.
- **429 Rate Limit**: Too many requests
  - Solution: Wait and retry; HubSpot REST API has rate limits
- **Missing email/phone**: Adapter creates contact with firstname/lastname only (no email)
  - This is expected for anonymous users; contact is still created successfully

**Debugging:**
- Check orchestrator logs for messages starting with `[info] HubSpot` or `[error] HubSpot`
- Each log includes `traceId` - use this to correlate requests
- Verify `INTEGRATION_MODE_HUBSPOT=rest` and `HUBSPOT_ACCESS_TOKEN` is set
- Check `CrmLink` table in Prisma Studio for stored HubSpot IDs

### WooCommerce errors

- **401/403**: Verify `WOO_CONSUMER_KEY` and `WOO_CONSUMER_SECRET` are correct
- **HTTPS required**: `WOO_BASE_URL` must use HTTPS (WooCommerce REST API requirement)
- **Connection failed**: Ensure WooCommerce site is accessible and REST API is enabled

### Session not persisting

- Verify `DATABASE_URL` is correct and migrations applied (`pnpm db:migrate`)
- Check Prisma Studio: same `channel_user_id` should map to same `Customer` and `Thread`
- Thread context (`contextJson`) stores cart and recommendations
- Restart orchestrator and continue chat - state should persist

### General debugging

- All orchestrator logs include `traceId` - use this to trace requests end-to-end
- Check Next.js console for fetch errors (CORS, network issues)
- Verify orchestrator is running on `http://localhost:4000` (check logs on startup)
- Use `pnpm db:studio` to inspect database state

---

- **M2 — Group order lifecycle + payments**
  - Model full group order lifecycle:
    - Invitations, partial orders, cut-off times, modifications.
  - Integrate payment adapter:
    - Pre-auth, capture, refunds.
  - Add observability for drop-off points in the flow.

- **M3 — Multi-channel integration**
  - Expand beyond the initial channel (e.g. web chat) to:
    - SMS / WhatsApp
    - Email
    - Other partner channels (as needed)
  - Ensure the orchestration pipeline stays **channel-agnostic** via the Normalize → Identity → Intent → Flow model.

---

## Contributing

- Open issues for any questions about architecture or flows.
- Keep this README and any `docs/` up to date as you add:
  - New tables / migrations
  - New tools / adapters
  - New flows and demo scenarios

