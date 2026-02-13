# Taste Labs M1 Demo Script

This script walks through the Milestone 1 end‑to‑end flow:

- Next.js web chat UI
- Express orchestrator service
- Supabase Postgres + Prisma
- DB-backed session/memory using threads
- Rule-based intent routing
- HubSpot contact + deal updates

## 1. Prerequisites

- Node.js 18+ and pnpm installed
- Database ready and `DATABASE_URL` set in `.env`
- Prisma client generated and migrations applied:

```bash
pnpm install  # Generates Prisma client automatically
pnpm db:migrate  # Apply database migrations
```

**Note**: If you see "Cannot find module '.prisma/client/default'" errors, run `pnpm db:generate` manually.

## 2. Environment variables

Create a `.env` in the repo root based on `.env.example`:

- `DATABASE_URL` – your Supabase Postgres URL
- `HUBSPOT_ACCESS_TOKEN` – (optional) private app token
- `HUBSPOT_PIPELINE_ID` – (optional) pipeline for new deals
- `HUBSPOT_STAGE_ID` – (optional) stage for new deals
- `ORCHESTRATOR_URL` – should be `http://localhost:4000`
- `NEXT_PUBLIC_ORCHESTRATOR_URL` – should be `http://localhost:4000`

If HubSpot env vars are omitted, the HubSpot adapter runs in **stub** mode and only logs calls without hitting the API.

## 3. Start the services

From the repo root:

```bash
pnpm install
pnpm dev
```

This will start:

- Next.js web app on `http://localhost:3000`
- Orchestrator Express API on `http://localhost:4000`

## 4. Demo flow: recommend → add item → offer checkout → HubSpot updated

1. **Open the chat UI**
   - Visit `http://localhost:3000` in your browser.

2. **Initial recommendation**
   - In the chat input, type something like:  
     `I'm hungry, what do you recommend?`
   - The orchestrator will:
     - Resolve a customer + foreground thread
     - Store the inbound message
     - Classify intent as **RECOMMEND**
     - Return 3 mock catalog items and prompt:  
       “Reply `add 1`, `add 2`, or `add 3` to add an item to your cart.”
     - Store an outbound message and update thread context with:
       - `last_intent: "RECOMMEND"`
       - `last_recommendations: [...]`

3. **Add to cart**
   - Reply in the chat with:  
     `add 1`
   - The orchestrator will:
     - Classify intent as **ADD_TO_CART**
     - Parse the item number from your message
     - Add the chosen item to a cart in `thread.contextJson`
     - Store inbound + outbound messages
     - Update context with:
       - `cart: [...]`
       - `last_intent: "ADD_TO_CART"`
       - `step: "awaiting_checkout_confirmation"`
     - Ask if you want to proceed to checkout.

4. **Checkout intent**
   - Reply with:  
     `checkout`  
     or `I want to pay`
   - The orchestrator will:
     - Classify intent as **CHECKOUT_INTENT**
     - Generate a mock checkout URL (e.g. `https://checkout.example.com/mock/<thread-id>`)
     - Update thread context with:
       - `step: "awaiting_payment"`
       - `checkout_url: "https://..."` (mock)
     - Return the URL in the reply.

5. **HubSpot behavior**
   - For **RECOMMEND** and **ADD_TO_CART** intents the orchestrator calls the HubSpot adapter:
     - Upserts a **Contact** using email/phone (if present), or creates a demo contact with `tl+{hash}@tastelabs.local` email if only `externalId` is available
     - Creates a **Deal** with title "Taste Labs Order Intent - {INTENT}" and associates it to the contact
     - Includes cart items in deal notes/meta when available
     - Stores the HubSpot IDs in the `CrmLink` table via `upsertCrmLink`
     - All HubSpot operations are logged with trace_id for debugging
   - If HubSpot env vars are not set, the adapter runs in **stub** mode and logs calls without hitting the API.
   - **Verification**: Check orchestrator logs for HubSpot sync messages with trace_id, or query HubSpot directly to see the created contact and deal.

## 5. JOIN_GROUP_ORDER stub

To see the **JOIN_GROUP_ORDER** behavior:

1. In the chat, send a message containing `group order` or `join`, for example:  
   `Can I join a group order?`
2. The orchestrator will:
   - Classify intent as **JOIN_GROUP_ORDER**
   - Return a stub reply, e.g.:  
     “Group orders are part of Milestone 2; I can notify you once they’re available.”
   - No real group order logic runs yet (M2 feature).

## 6. Inspecting data

- Use `pnpm db:studio` to open Prisma Studio and inspect:
  - `Customer`, `ChannelIdentity`
  - `Thread` + `Message` history (check `contextJson` for cart and recommendations)
  - `CrmLink` entries with HubSpot IDs (when HubSpot sync succeeds)

## 7. Troubleshooting

### HubSpot sync not working

1. **Check logs**: Look for HubSpot-related log messages in the orchestrator console. Each operation includes:
   - `traceId` - unique identifier for the request
   - `mode` - adapter mode (rest/mcp/stub)
   - `hasToken` - whether HUBSPOT_ACCESS_TOKEN is set
   - Request/response details

2. **Common HubSpot errors**:
   - **401 Unauthorized**: Token is invalid or expired. Regenerate `HUBSPOT_ACCESS_TOKEN`.
   - **403 Forbidden**: Token lacks required scopes. Ensure scopes: `crm.objects.contacts.write`, `crm.objects.deals.write`.
   - **429 Too Many Requests**: Rate limit exceeded. HubSpot REST API has rate limits; wait and retry.
   - **Missing scopes**: Check HubSpot private app settings and ensure all CRM write permissions are enabled.

3. **No email/phone**: The adapter will create a demo contact with email `tl+{hash}@tastelabs.local` when only `externalId` is available. This is for demo purposes only.

4. **Verify HubSpot writes**:
   - Check orchestrator logs for "HubSpot sync completed" messages with `contactId` and `dealId`
   - Query `CrmLink` table in Prisma Studio to see stored HubSpot IDs
   - Check HubSpot UI directly for the created contact and deal

### WooCommerce errors

- **401/403**: Check `WOO_CONSUMER_KEY` and `WOO_CONSUMER_SECRET` are correct
- **HTTPS required**: Ensure `WOO_BASE_URL` uses HTTPS (required by WooCommerce REST API)
- **Connection errors**: Verify the WooCommerce site is accessible and REST API is enabled

### Session continuity

- Restart the orchestrator server and continue chatting with the same `channel_user_id`
- The system should retain state (cart, recommendations) via `Thread.contextJson`
- Verify by checking Prisma Studio: same customer ID, same thread ID, context preserved

