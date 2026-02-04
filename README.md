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
- **Integrations (planned / in progress)**:
  - **HubSpot**: CRM data, contacts, deals, timelines.
  - **WooCommerce**: product catalog, carts, orders.
  - **Payments**: pluggable payment adapter (placeholder for now).

---

## 2. Milestones status

- **M0 — Docs & Foundations**: ✅ **Done**
  - Project scope, high-level architecture, initial schemas and flows defined.
- **M1 — Core Concierge Demo**: ⏳ **In progress** (or ✅ complete, update as needed)
  - End-to-end demo for a core AI concierge flow.
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

> **TODO:** Fill in with your actual stack (Node/Python/etc.) and commands.

- **Prerequisites:**
  - **Runtime**: e.g. Node.js 20+ / Python 3.11+ / Docker.
  - **Database**: e.g. Postgres running locally or via Docker.

- **Env vars:**
  Create a `.env` file (or equivalent) with at least:
  - `APP_ENV=local`
  - `PORT=...`
  - `DATABASE_URL=postgres://...`
  - `HUBSPOT_API_KEY=...` or OAuth config
  - `WOO_BASE_URL=...`
  - `WOO_CONSUMER_KEY=...`
  - `WOO_CONSUMER_SECRET=...`
  - `PAYMENT_PROVIDER_API_KEY=...` (when implemented)

- **Install dependencies:**

```bash
# Node (example)
npm install
# or
pnpm install

# Python (example)
uv sync  # or pip install -r requirements.txt
```

- **Run migrations:**

```bash
# replace with your actual migration command
npm run db:migrate
```

- **Start the app:**

```bash
npm run dev        # or npm start / uv run app.py
```

Once the stack is chosen, replace the examples above with the exact commands.

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

## 8. Next steps

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

