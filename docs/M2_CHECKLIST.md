# Milestone 2 — Checklist & Plan

## Context

Contract M2 title: "Group Orders and Payment Logic" ($1,500 / 2 weeks)

Gil's direction from chat: M2 should focus on making the concierge feel like a real conversational shopping experience — natural dialogue, product details with images/prices, smart cart management, complementary suggestions, and a payment link flow. He also wants deeper WooCommerce integration since cart functionality already exists there.

This checklist reconciles Gil's requests with the contract deliverables and identifies what we need from Gil before starting.

---

## Things We Need From Gil Before Starting

These are blockers or decisions that require Gil's input:

| # | Item | Why We Need It | Status |
|---|------|---------------|--------|
| 1 | **LLM provider decision** | Natural conversation requires an LLM | ✅ Confirmed: OpenAI (gpt-4.1-mini). Gil to provide API key |
| 2 | **WooCommerce product catalog readiness** | Gil wants real product data with images, prices, descriptions. We need to confirm: are products populated in WooCommerce with images? Are there product categories/tags for cross-sell logic? | ⬜ Waiting |
| 3 | **WooCommerce cart API scope** | Gil said "integrate to woocommerce because you already have cart functionality" | ✅ Confirmed: Use WooCommerce for cart (syncs with HubSpot) |
| 4 | **Product types: "regular/stock/import"** | Gil mentioned product selection types. We need: what are the exact categories? Do they exist as WooCommerce attributes/tags, or are they custom? How do they affect pricing/availability? | ⬜ Waiting |
| 5 | **Payment provider** | Contract says "split payment logic." Which provider? | ✅ Decision: Mock/stub for M2, real provider plugged in later |
| 6 | **Group order business rules** | Contract requires group order lifecycle. We need: how does a group order start? Who can join? What's the MOQ threshold? Is there a time limit? Can members modify after joining? | ⬜ Waiting |
| 7 | **Cross-sell / complementary product rules** | Gil wants the bot to suggest related products | ✅ Confirmed: AI-generated from existing WooCommerce product catalog |

---

## Deliverables Breakdown

### A. Natural Conversational AI (Gil's Core Request)

What exists today: Rule-based intent classifier with hardcoded reply templates.
What M2 needs: LLM-driven conversation that feels natural.

- [ ] **A1. Integrate LLM provider** (OpenAI / Anthropic / other)
  - Add LLM client to orchestrator (new adapter, same pattern as HubSpot/Woo)
  - System prompt that defines the concierge personality, product knowledge, and conversation rules
  - LLM receives: user message + thread context (cart, last recommendations, step) + product catalog context
  - LLM returns: natural reply text + structured action (recommend, add_to_cart, checkout, etc.)

- [ ] **A2. Replace hardcoded intent classifier with LLM-based routing**
  - LLM classifies intent as part of generating the reply (no separate keyword matching)
  - Keep rule-based classifier as fallback if LLM is unavailable
  - Add new intents as needed: SHOW_CART, EDIT_CART, REMOVE_FROM_CART, PRODUCT_DETAILS, CROSS_SELL

- [ ] **A3. Conversational memory in LLM context**
  - Pass recent message history (last N messages from Thread) to LLM for context
  - Include cart state, user preferences, and last recommendations in system prompt
  - LLM should be able to reference previous conversation naturally

---

### B. Product Cards with Details (Gil's Request)

What exists today: Plain text list ("1. Margherita Pizza — Classic pizza...").
What M2 needs: Rich product display with image, price, description.

- [ ] **B1. Extend WooProduct type to include image URL**
  - Add `images` field to `WooProduct` type
  - Update REST adapter to extract image URLs from WooCommerce response
  - Update mock adapter with placeholder image URLs for dev/demo

- [ ] **B2. Structured reply format from orchestrator**
  - Change `OrchestratorReply` to support rich content (not just plain text)
  - Add `products` array to reply: `{ id, name, price, image_url, description, permalink }`
  - Frontend renders product cards instead of plain text when products are present

- [ ] **B3. Product card UI component in Next.js**
  - Card with: image, name, price, short description
  - "Add to cart" button on each card (with quantity selector)
  - "More details" action that asks the bot for full product info
  - Consistent numbering that matches what the bot references

- [ ] **B4. Progressive detail disclosure**
  - Initial recommendation shows minimal info (image, name, price)
  - User can ask "tell me more about item 2" → bot returns full description, ingredients, etc.
  - This is driven by LLM understanding the request + calling `getProduct` for full details

---

### C. Smart Cart Management (Gil's Request)

What exists today: "add 1" appends item to `contextJson.cart`. No quantities, no totals, no editing.
What M2 needs: Full cart with quantities, totals, edit/remove, and summary view.

- [ ] **C1. Cart data model upgrade**
  - Cart items include: productId, name, price, quantity, image_url
  - Support quantity > 1 (e.g., "add 3 of item 1")
  - Calculate line totals and cart total

- [ ] **C2. Robust add-to-cart parsing**
  - LLM handles natural language: "I want 2 pizzas", "add another brownie", "give me one of each"
  - If ambiguous, bot asks clarifying question ("Which pizza — Margherita or Pepperoni?")
  - If item not found, bot suggests closest match

- [ ] **C3. Cart operations**
  - View cart: "show my cart" / "what's in my cart" → bot returns formatted cart summary with totals
  - Edit quantity: "change pizza to 3" / "I want 2 more brownies"
  - Remove item: "remove the brownie" / "take out item 2"
  - Clear cart: "start over" / "empty my cart"

- [ ] **C4. Cart summary UI component**
  - Rendered in chat when user asks to see cart or before checkout
  - Shows: items, quantities, line prices, total
  - Edit/remove buttons per item

- [ ] **C5. WooCommerce cart sync (if Gil confirms)**
  - If using Woo cart API: sync our cart state to WooCommerce on each change
  - If keeping cart in DB only: sync to Woo only at checkout time
  - Decision depends on Gil's answer to item #3 above

---

### D. Cross-Sell / Complementary Suggestions (Gil's Request)

What exists today: Nothing — bot only shows initial recommendations.
What M2 needs: After adding an item, bot suggests related products.

- [ ] **D1. Cross-sell logic**
  - After add-to-cart, bot suggests 1-2 complementary items
  - Source: WooCommerce related/upsell products, or LLM-driven based on what's in cart
  - Example: user adds pizza → bot suggests "Would you like a drink or dessert with that?"

- [ ] **D2. User history-based suggestions**
  - If customer has previous orders/preferences (stored in `Customer.preferencesJson`), factor into suggestions
  - LLM uses this context to personalize: "Last time you ordered the Veggie Bowl — want to add it again?"

---

### E. Product Type Selection (Gil's Mention of "regular/stock/import")

- [ ] **E1. Support product type/variant selection**
  - When a product has types (regular, stock, import), bot presents options
  - Selected type stored in cart item and in thread context
  - Type selection synced to CRM metadata (HubSpot deal meta)

---

### F. Payment Flow (Contract Deliverable)

What exists today: Mock checkout URL (`checkout.example.com/mock/{threadId}`).
What M2 needs: Payment adapter stub that preserves the full flow, ready for real provider.

- [ ] **F1. Payment adapter interface**
  - Define `PaymentAdapter` type: `createCheckoutSession(cart, customer) → { checkoutUrl, sessionId }`
  - Three modes (same pattern): `real` (Stripe/PayPlus/etc.), `sandbox`, `stub`
  - Stub generates internal checkout page with cart summary

- [ ] **F2. Split payment logic (contract requirement)**
  - 50% down payment on order confirmation
  - 50% final payment on delivery/completion
  - Track payment state in thread context and/or new `Payment` table
  - Webhook handler for payment status updates (sandbox mode)

- [ ] **F3. Checkout flow in conversation**
  - Bot shows cart summary with total → asks for confirmation
  - On confirm → creates checkout session → returns payment link
  - Bot tracks payment status: "awaiting_payment" → "payment_received" → "order_confirmed"

- [ ] **F4. Payment webhooks (sandbox)**
  - `POST /api/webhooks/payment` endpoint
  - Updates thread context and order status on payment events
  - Handles: success, failure, partial payment

---

### G. Group Order Lifecycle (Contract Deliverable)

What exists today: Stub that returns "Group orders are part of Milestone 2."
What M2 needs: Working group order creation, joining, and MOQ tracking.

- [ ] **G1. Group order creation flow**
  - User says "I want to start a group order" → bot creates GroupOrder record
  - Sets manufacturer constraint, MOQ target, expiry time
  - Generates shareable join link/code

- [ ] **G2. Join group order flow**
  - User provides group order code/link → bot adds them as participant
  - Each participant can add items to their portion of the order
  - Bot shows group progress: "5 of 10 minimum items reached"

- [ ] **G3. MOQ tracking and state machine**
  - GroupOrder states: DRAFT → OPEN → MOQ_MET → CONFIRMED → CLOSED
  - When MOQ is met → notify all participants, trigger payment flow
  - If expiry reached without MOQ → notify participants, handle gracefully

- [ ] **G4. Success/failure handling (contract requirement)**
  - MOQ met: proceed to split payment
  - MOQ not met by deadline: notify all, offer options (extend, cancel, individual order)
  - Participant drops out: recalculate MOQ progress, notify group

---

### H. Infrastructure / Shared Work

- [ ] **H1. Update `OrchestratorReply` type in shared package**
  - Add optional `products`, `cart`, `checkout` fields for structured UI rendering
  - Keep backward compatible (plain `reply` text still works)

- [ ] **H2. Update Prisma schema if needed**
  - Payment table (if not using external-only tracking)
  - GroupOrder participant relation
  - Run migration

- [ ] **H3. Environment variables for new integrations**
  - LLM provider: `LLM_PROVIDER`, `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
  - Payment: `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY` (or equivalent)
  - Update `.env.example`

- [ ] **H4. Error handling**
  - LLM timeout/failure → fall back to rule-based classifier + template replies
  - Payment failure → clear error message to user + retry option
  - WooCommerce unavailable → graceful degradation with cached/mock data

---

## Priority Order (Suggested)

Based on Gil's emphasis in the chat, this is the recommended build order:

1. **LLM integration** (A1-A3) — this is the foundation for "natural conversation"
2. **Product cards + rich display** (B1-B4) — visual impact for demo
3. **Smart cart** (C1-C4) — core shopping experience
4. **Cross-sell** (D1-D2) — makes the bot feel intelligent
5. **Payment stub + checkout flow** (F1, F3) — completes the purchase journey
6. **Group order lifecycle** (G1-G4) — contract deliverable
7. **Split payment + webhooks** (F2, F4) — contract deliverable
8. **WooCommerce cart sync** (C5) — depends on Gil's decision
9. **Product types** (E1) — depends on Gil's clarification

---

## Demo Script (What Gil Should See at M2 End)

1. User opens chat, asks naturally: "Hey, I'm looking for something for dinner tonight"
2. Bot responds conversationally, shows product cards with images and prices
3. User: "That pizza looks good, add 2" → bot adds with quantity, suggests a dessert
4. User: "Sure, add a brownie too" → bot adds, shows updated cart total
5. User: "Actually make it 3 pizzas" → bot updates quantity
6. User: "Show me my cart" → bot shows formatted cart with totals
7. User: "Let's checkout" → bot confirms cart, provides payment link
8. User clicks payment link → stub checkout page → payment confirmed
9. Group order demo: user creates group order → shares code → second user joins → MOQ tracked
10. All data visible in HubSpot (contact, deal with cart details) and database

---

## Contract Alignment Note

The contract M2 deliverables are:
- ✅ Group order lifecycle (creation, joining, MOQ tracking) → Section G
- ✅ Success/failure handling → Section G4
- ✅ Split payment logic (50% down, 50% final) → Section F2
- ✅ Payment webhooks in sandbox → Section F4

Gil's additional requests (natural conversation, product cards, smart cart, cross-sell) are enhancements to the "functional flow" quality, not scope expansion — they make the existing flows production-worthy rather than adding new contract scope. This is consistent with the contract principle: "Each milestone ends with a clear demo understandable to non-technical stakeholders."
