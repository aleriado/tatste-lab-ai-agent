# Milestone 2 — Implementation Plan

## Summary

Transform the concierge from rule-based responses into a natural AI shopping assistant with
tool-calling LLM, rich product cards, real cart management, cross-sell, group orders, and mock payment flow.

**LLM Provider:** OpenAI (gpt-4.1-mini default)
**Cart Strategy:** WooCommerce as source of truth (syncs with HubSpot)
**Cross-Sell:** AI-generated from existing WooCommerce product catalog
**Payment:** Mock/stub for M2, real provider plugged in later

---

## Current State (What Exists from M1)

| Component | Current State | M2 Change Needed |
|-----------|--------------|-----------------|
| Intent classifier | Rule-based keyword matching | Replace with LLM tool-calling loop |
| Flows (recommend, addToCart, checkout, joinGroupOrder) | Hardcoded template replies | Replace with LLM-generated natural responses |
| WooCommerce adapter | REST search + mock catalog | Extend: variations, related products, images, full details |
| HubSpot adapter | Contact upsert + deal creation | Keep as-is, add cart/order event logging |
| Cart | JSON array in `Thread.contextJson` | Move to dedicated `Cart` + `CartItem` tables |
| Group orders | Stub ("M2 feature") | Full lifecycle with `GroupOrder`, participants, items, MOQ |
| Payment | Mock URL string | Payment adapter stub with split logic |
| Frontend | Plain text chat bubbles | Rich cards, cart summary, quick actions, link bubbles |
| Shared types | `Intent`, `InboundMessagePayload`, `OrchestratorReply` | Extend reply type with cards, cart, suggestions, links |
| Prisma schema | 10 tables (Customer, Thread, Message, etc.) | Add Cart, CartItem, GroupOrderParticipant, GroupOrderItem, extend GroupOrder |

---

## Phase 1: Database & Schema (Do First)

### 1.1 New Prisma Models

Add to `prisma/schema.prisma`:

**Cart + CartItem** (replaces `contextJson.cart`)
```prisma
model Cart {
  id             String     @id @default(cuid())
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  customerId     String
  customer       Customer   @relation(fields: [customerId], references: [id], onDelete: Cascade)
  currency       String     @default("ILS")
  items          CartItem[]

  @@unique([customerId])
  @@index([customerId])
}

model CartItem {
  id          String   @id @default(cuid())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  cartId      String
  cart        Cart     @relation(fields: [cartId], references: [id], onDelete: Cascade)
  productId   String
  variantId   String?
  name        String
  imageUrl    String?
  unitPrice   Decimal  @db.Decimal(10, 2)
  quantity    Int      @default(1)
  metadata    Json?

  @@unique([cartId, productId, variantId])
  @@index([cartId])
}
```

**GroupOrderParticipant + GroupOrderItem** (extend existing GroupOrder)
```prisma
// Update existing GroupOrder model — add relations + code field
model GroupOrder {
  // ... existing fields ...
  code            String    @unique @db.VarChar(8)
  createdByCustomerId String
  participants    GroupOrderParticipant[]
  items           GroupOrderItem[]
}

model GroupOrderParticipant {
  id             String     @id @default(cuid())
  createdAt      DateTime   @default(now())
  groupOrderId   String
  groupOrder     GroupOrder @relation(fields: [groupOrderId], references: [id], onDelete: Cascade)
  customerId     String
  customer       Customer   @relation(fields: [customerId], references: [id])

  @@unique([groupOrderId, customerId])
  @@index([groupOrderId])
}

model GroupOrderItem {
  id             String     @id @default(cuid())
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  groupOrderId   String
  groupOrder     GroupOrder @relation(fields: [groupOrderId], references: [id], onDelete: Cascade)
  customerId     String
  productId      String
  variantId      String?
  name           String
  imageUrl       String?
  unitPrice      Decimal    @db.Decimal(10, 2)
  quantity       Int        @default(1)
  metadata       Json?

  @@index([groupOrderId])
  @@index([groupOrderId, customerId])
}
```

### 1.2 Migration

```bash
pnpm db:migrate --name m2_cart_group_orders
```

### 1.3 DB Helper Functions

Add to `packages/db/src/index.ts` (or split into separate files):

- `getOrCreateCart(customerId)` → Cart with items
- `addCartItem(customerId, item)` → upsert (increment qty if same product+variant)
- `updateCartItemQty(customerId, productId, variantId, qty)`
- `removeCartItem(customerId, productId, variantId?)`
- `clearCart(customerId)`
- `getCartSummary(customerId)` → items + subtotal + total
- `createGroupOrder(customerId, moqTarget, deadlineHours)` → GroupOrder with code
- `joinGroupOrder(code, customerId)`
- `leaveGroupOrder(code, customerId)` → remove participant + their items, recalc MOQ
- `addGroupOrderItem(code, customerId, item)`
- `removeGroupOrderItem(code, customerId, productId)`
- `getGroupOrderStatus(code)` → participants, items, moqCurrent, moqTarget, status, deadline
- `checkGroupOrderExpiry(code)` → if past deadline and not MOQ_REACHED, set EXPIRED

---

## Phase 2: WooCommerce Integration (Extend Existing)

### 2.1 Extend WooProduct Type

In `services/orchestrator/src/adapters/woocommerce/types.ts`:

```typescript
export interface WooProduct {
  id: string;
  name: string;
  price?: string;
  permalink?: string;
  description?: string;
  shortDescription?: string;
  images?: { src: string; alt?: string }[];
  categories?: { id: number; name: string }[];
  type?: 'simple' | 'variable' | 'grouped';
  inStock?: boolean;
  relatedIds?: number[];
  crossSellIds?: number[];
  upsellIds?: number[];
}

export interface WooVariation {
  id: string;
  price?: string;
  attributes: { name: string; option: string }[];
  inStock?: boolean;
}
```

### 2.2 Extend WooCommerceAdapter Interface

```typescript
export interface WooCommerceAdapter {
  searchProducts(query: string, filters?: { category?: string; limit?: number }): Promise<WooProduct[]>;
  getProduct(productId: string): Promise<WooProduct | null>;
  getProductVariations(productId: string): Promise<WooVariation[]>;
  getRelatedProducts(productId: string): Promise<WooProduct[]>;
}
```

### 2.3 Update REST Adapter

Update `services/orchestrator/src/adapters/woocommerce/rest.ts`:
- `searchProducts` — include images, categories, type, stock status in response mapping
- `getProduct` — return full detail including gallery images, attributes
- `getProductVariations` — `GET /wp-json/wc/v3/products/{id}/variations`
- `getRelatedProducts` — use product's `related_ids` / `cross_sell_ids` / `upsell_ids`, fetch those products

### 2.4 Update Mock Adapter

Update mock to include images (placeholder URLs), categories, and variations for dev/demo.

---

## Phase 3: OpenAI LLM Integration (Core Change)

### 3.1 New Files

```
services/orchestrator/src/ai/
  ├── openaiClient.ts      # OpenAI SDK setup
  ├── systemPrompt.ts      # System prompt template
  ├── tools.ts             # Tool definitions (OpenAI function calling schema)
  ├── toolExecutor.ts      # Maps tool calls → actual service functions
  └── chatLoop.ts          # Main loop: user msg → LLM → tool calls → LLM → reply
```

### 3.2 Environment Variables

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
```

### 3.3 System Prompt (`systemPrompt.ts`)

The system prompt must instruct the LLM to:
1. Be a friendly, helpful shopping concierge for Taste Labs
2. Never invent product information — always call tools to get real data
3. Show minimal info first (name, price, 1-liner), expand on request
4. Ask clarifying questions when ambiguous (which product? what quantity? which variant?)
5. After adding to cart, suggest complementary products
6. Always offer to show cart before checkout
7. Track conversation context (what was shown, what's in cart)
8. Support group order flows naturally
9. Respond in the user's language (Hebrew/English based on input)

The prompt receives dynamic context:
- Current cart state (items, totals)
- Recent conversation history (last N messages from Thread)
- Customer preferences if available
- Group order context if active

### 3.4 Tool Definitions (`tools.ts`)

Define OpenAI function calling tools:

```typescript
const tools = [
  {
    type: "function",
    function: {
      name: "product_search",
      description: "Search the product catalog. Use when user asks for recommendations or mentions a product type.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query based on user request" },
          limit: { type: "number", description: "Max results (default 6)" }
        },
        required: ["query"]
      }
    }
  },
  // product_detail, product_variations, cart_add_item, cart_remove_item,
  // cart_update_quantity, cart_view, suggest_complements,
  // group_create, group_join, group_leave, group_status,
  // group_add_item, group_remove_item, checkout_begin
]
```

### 3.5 Tool Executor (`toolExecutor.ts`)

Maps each tool name to the actual function:

```typescript
async function executeTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  switch (name) {
    case 'product_search':
      return wooAdapter.searchProducts(args.query as string, { limit: args.limit as number });
    case 'product_detail':
      return wooAdapter.getProduct(args.productId as string);
    case 'cart_add_item':
      return addCartItem(context.customerId, { ... });
    // ... etc
  }
}
```

### 3.6 Chat Loop (`chatLoop.ts`)

The main orchestration loop:

```
1. Receive user message + context (cart, history, customer)
2. Build messages array: [system prompt, ...history, user message]
3. Call OpenAI chat completion with tools
4. If response has tool_calls:
   a. Execute each tool
   b. Append tool results to messages
   c. Call OpenAI again (loop, max 5 iterations)
5. When LLM returns final text (no more tool calls):
   a. Parse for structured output (product cards, cart snapshot, suggestions)
   b. Return to orchestrator
```

### 3.7 Update Orchestrator Pipeline

In `services/orchestrator/src/index.ts`:

Replace the current flow:
```
classifyIntent → switch(intent) → runFlow → template reply
```

With:
```
chatLoop(userMessage, context) → { text, cards, cart, suggestions, link }
```

Keep the old rule-based classifier as fallback if LLM fails (timeout, API error, etc.).

---

## Phase 4: Cart Service

### 4.1 Cart Service (`services/orchestrator/src/services/cart.ts`)

Functions that the LLM tools call:

- `addToCart(customerId, productId, variantId?, quantity)` — fetches product from Woo, upserts CartItem
- `removeFromCart(customerId, productId, variantId?)`
- `updateQuantity(customerId, productId, variantId?, newQty)`
- `viewCart(customerId)` → `{ items: [...], subtotal, total, currency, itemCount }`
- `clearCart(customerId)`

Business rules:
- If same product+variant already in cart, increment quantity
- Totals computed server-side: `subtotal = sum(unitPrice * qty)`, `total = subtotal` (no tax/shipping for M2)
- If product not found in Woo, return error message (LLM will relay to user)

---

## Phase 5: Group Order Service

### 5.1 Group Order Service (`services/orchestrator/src/services/groupOrder.ts`)

- `createGroupOrder(customerId, moqTarget, deadlineHours?)` → generates short code (6 chars), creates record, adds creator as first participant
- `joinGroupOrder(code, customerId)` → adds participant, returns current status
- `leaveGroupOrder(code, customerId)` → removes participant + their items, recalculates MOQ
- `addGroupOrderItem(code, customerId, productId, variantId?, qty)` → adds item, recalculates MOQ
- `removeGroupOrderItem(code, customerId, productId)` → removes, recalculates
- `getGroupOrderStatus(code)` → full status with participants, items, MOQ progress, deadline
- `checkAndUpdateExpiry(code)` → called on every read; if past deadline and status is OPEN, set to EXPIRED

State machine:
```
DRAFT → OPEN (when first item added)
OPEN → MOQ_REACHED (when moqCurrent >= moqTarget)
OPEN → EXPIRED (when deadline passes without MOQ)
MOQ_REACHED → CHECKOUT_STARTED (when checkout_begin called)
CHECKOUT_STARTED → CONFIRMED (when mock payment confirmed)
```

MOQ calculation: `sum(quantity)` across all `GroupOrderItem` for this group order.

---

## Phase 6: Payment Stub

### 6.1 Payment Adapter (`services/orchestrator/src/adapters/payment/`)

```
services/orchestrator/src/adapters/payment/
  ├── types.ts       # PaymentAdapter interface
  ├── stub.ts        # Mock implementation
  └── index.ts       # Adapter selector (stub for now)
```

Interface:
```typescript
interface PaymentAdapter {
  createCheckoutSession(params: {
    customerId: string;
    cartTotal: number;
    currency: string;
    splitPayment: boolean;
    meta?: Record<string, unknown>;
  }): Promise<{
    sessionId: string;
    paymentUrl: string;
    amountDueNow: number;
    amountDueLater: number;
  }>;

  confirmPayment(sessionId: string): Promise<{
    status: 'success' | 'failed';
    paidAmount: number;
  }>;
}
```

Stub implementation:
- `createCheckoutSession` → generates a token, returns `${APP_URL}/pay/mock?token=...`, calculates 50/50 split
- `confirmPayment` → always returns success (for demo)

### 6.2 Mock Payment Endpoint

Add to orchestrator:
- `POST /api/mock-payment/confirm` — marks payment as confirmed, updates thread context

---

## Phase 7: Shared Types Update

### 7.1 Extend `OrchestratorReply` in `packages/shared/src/index.ts`

```typescript
export interface ProductCard {
  id: string;
  name: string;
  price?: string;
  imageUrl?: string;
  shortDescription?: string;
  type?: 'simple' | 'variable';
}

export interface CartSnapshot {
  items: {
    productId: string;
    name: string;
    imageUrl?: string;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
  }[];
  subtotal: string;
  total: string;
  currency: string;
  itemCount: number;
}

export interface OrchestratorReply {
  trace_id: string;
  reply: string;
  intent?: string;
  thread_id: string;
  cards?: ProductCard[];
  cart?: CartSnapshot;
  suggestions?: string[];
  link?: { url: string; label: string };
  groupOrder?: {
    code: string;
    status: string;
    moqCurrent: number;
    moqTarget: number;
    participantCount: number;
  };
}
```

---

## Phase 8: Frontend (Next.js)

### 8.1 New UI Components

```
apps/web/app/components/
  ├── ProductCard.tsx      # Image + name + price + description + "Add" button
  ├── CartSummary.tsx      # Items list + qty controls + totals
  ├── QuickActions.tsx     # Suggestion chips ("View cart", "Add x1", "Checkout")
  ├── LinkBubble.tsx       # Payment link / group order link
  ├── GroupOrderStatus.tsx # MOQ progress bar + participant count
  └── ChatMessage.tsx      # Updated: renders text + optional cards/cart/link
```

### 8.2 Chat Message Rendering

Update `page.tsx` to handle rich replies:
- If `reply.cards` present → render ProductCard grid
- If `reply.cart` present → render CartSummary
- If `reply.suggestions` present → render QuickActions chips
- If `reply.link` present → render LinkBubble
- If `reply.groupOrder` present → render GroupOrderStatus
- Always render `reply.reply` as text

### 8.3 Quick Actions

When user clicks a suggestion chip (e.g., "Add x1", "View cart"), send it as a regular text message to the orchestrator. The LLM handles it naturally.

---

## Phase 9: Environment & Config

### 9.1 New Environment Variables

Add to `.env` and `.env.example`:

```env
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini

# App URL (for mock payment links + group order links)
APP_URL=http://localhost:3000
```

### 9.2 Package Dependencies

Orchestrator:
```bash
pnpm --filter orchestrator add openai
```

---

## Build Order (Recommended Sequence)

| Step | What | Why First |
|------|------|-----------|
| 1 | Prisma schema + migration | Everything depends on the data model |
| 2 | DB helper functions (cart, group order) | Services need these |
| 3 | Extend WooCommerce adapter (images, variations, related) | LLM tools need product data |
| 4 | Shared types update (OrchestratorReply, ProductCard, CartSnapshot) | Both backend and frontend need these |
| 5 | Cart service | LLM tools call this |
| 6 | Group order service | LLM tools call this |
| 7 | Payment stub adapter | Checkout tool calls this |
| 8 | OpenAI integration + system prompt + tools + chat loop | The core M2 change |
| 9 | Update orchestrator pipeline (replace rule-based with LLM loop) | Wire it all together |
| 10 | Frontend components (ProductCard, CartSummary, QuickActions, etc.) | Visual layer |
| 11 | Frontend chat rendering update | Display rich replies |
| 12 | Testing + demo script | Verify everything works end-to-end |

---

## Files That Will Be Created (New)

```
services/orchestrator/src/ai/openaiClient.ts
services/orchestrator/src/ai/systemPrompt.ts
services/orchestrator/src/ai/tools.ts
services/orchestrator/src/ai/toolExecutor.ts
services/orchestrator/src/ai/chatLoop.ts
services/orchestrator/src/services/cart.ts
services/orchestrator/src/services/groupOrder.ts
services/orchestrator/src/adapters/payment/types.ts
services/orchestrator/src/adapters/payment/stub.ts
services/orchestrator/src/adapters/payment/index.ts
apps/web/app/components/ProductCard.tsx
apps/web/app/components/CartSummary.tsx
apps/web/app/components/QuickActions.tsx
apps/web/app/components/LinkBubble.tsx
apps/web/app/components/GroupOrderStatus.tsx
apps/web/app/components/ChatMessage.tsx
docs/M2_DEMO_SCRIPT.md
```

## Files That Will Be Modified

```
prisma/schema.prisma                                    # New models
packages/shared/src/index.ts                            # Extended types
packages/db/src/index.ts                                # New DB helpers (or split into files)
services/orchestrator/src/index.ts                      # New pipeline (LLM loop replaces switch)
services/orchestrator/src/adapters/woocommerce/types.ts # Extended product type
services/orchestrator/src/adapters/woocommerce/rest.ts  # New methods
services/orchestrator/src/adapters/woocommerce/mock.ts  # Updated mock data
services/orchestrator/src/adapters/woocommerce/index.ts # Export new methods
services/orchestrator/package.json                      # Add openai dependency
apps/web/app/page.tsx                                   # Rich message rendering
apps/web/app/globals.css                                # New component styles
.env.example                                            # New env vars
```
