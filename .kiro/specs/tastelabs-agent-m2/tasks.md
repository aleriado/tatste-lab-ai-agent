# Implementation Plan: TasteLabs Agent M2

## Overview

Extend the existing conversational commerce agent into a context-aware, multi-order-type shopping assistant. Implementation builds on the existing monorepo: `apps/web` (Next.js), `services/orchestrator` (Express + OpenAI tool-calling loop), `packages/db` (Prisma + group order allocation), and `packages/shared` (shared types). All new features integrate into the existing tool-calling chat loop and surface/layer allocation engine.

## Tasks

- [x] 1. Extend data models and shared types for multi-order-type support
  - [x] 1.1 Add `orderType`, `isImport`, and `maxParticipants` fields to the `GroupOrder` model in `prisma/schema.prisma` and create a Prisma migration
    - Add `OrderType` enum (`GROUP`, `IMPORT`) to the schema
    - Add `orderType OrderType @default(GROUP)`, `isImport Boolean @default(false)`, `maxParticipants Int?` to `GroupOrder`
    - Run `npx prisma migrate dev` to generate the migration
    - _Requirements: 2.1, 2.6_

  - [x] 1.2 Add new shared types to `packages/shared/src/index.ts`
    - Add `ContextMetadata` interface (currentPage, product with state/pricingTiers, activeGroupOrder, userType)
    - Add `SessionContext` interface (sessionId, customerId, userType, shareSuggestionsCount, shareSuggestionsPerPage, lastInterventionGate, cookingContext, activeGroupOrders, activeImportOrders)
    - Add `InterventionResult` interface (gate, action, message, redirectTo, data)
    - Add `AvailableOrderTypes` and `OrderTypeOption` interfaces
    - Add `ImportOrderStatus` interface
    - Extend `InboundMessagePayload` with `contextMetadata?: ContextMetadata`
    - Extend `OrchestratorReply` with `importOrder?: ImportOrderSnapshot`
    - _Requirements: 1.1, 1.2, 11.1, 11.2_

  - [x] 1.3 Extend `ProductCard` in `packages/shared/src/index.ts` with product state field
    - Add `productState?: 'ACTIVE_IMPORTED' | 'CATALOG_EXTENSION'` to `ProductCard`
    - Add `dreamStage?: string` field for Dream List products
    - _Requirements: 3.1, 7.1_

  - [ ]* 1.4 Write property test: CATALOG_EXTENSION products never have prices in order type options
    - **Property 4: Price disclosure invariant**
    - **Validates: Requirements 6.1, 6.2**

- [x] 2. Implement Import Order Service in `packages/db`
  - [x] 2.1 Create `packages/db/src/groupOrder/importOrderService.ts` with core import order operations
    - Implement `createImportOrder(customerId, deadlineHours?)` — creates a GroupOrder with `isImport: true`, `maxParticipants: 1`
    - Implement `getOpenImportOrders(customerId, manufacturerId?)` — queries open import orders for the customer
    - Implement `addItemToImportOrder(code, customerId, product, quantityUnits)` — validates single-user constraint, delegates to existing `allocateToGroupOrder`
    - Implement `getImportOrderStatus(code)` — returns palette fill progress
    - Implement `checkoutImportOrder(code, customerId)` — validates and initiates checkout
    - Enforce same manufacturer constraint (reuse existing validation)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

  - [x] 2.2 Update `packages/db/src/groupOrder/repository.ts` to support import order queries
    - Add `loadImportOrdersByCustomer(customerId, manufacturerId?)` query
    - Add `validateImportOrderOwner(code, customerId)` check
    - Update `loadGroupOrderState` to include `isImport` and `maxParticipants` in returned state
    - _Requirements: 2.3, 2.5_

  - [x] 2.3 Export import order service from `packages/db/src/index.ts`
    - Re-export `importOrderService` functions
    - _Requirements: 2.1_

  - [ ]* 2.4 Write property test: Import orders never have more than 1 participant
    - **Property 2: Import order single-participant invariant**
    - **Validates: Requirements 2.1, 2.3**

- [x] 3. Checkpoint — Ensure data layer compiles and import order service works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Intervention Gate Engine in `services/orchestrator`
  - [x] 4.1 Create `services/orchestrator/src/ai/interventionGates.ts` with the gate evaluation engine
    - Implement `evaluateOrderTypeOptions(productId, customerId, sessionContext)` — runs AIS-01 (product state), AIS-02 (group order check), AIS-04 (price disclosure) and returns filtered `AvailableOrderTypes`
    - AIS-01: Check product state (ACTIVE_IMPORTED vs CATALOG_EXTENSION); block purchase paths for CATALOG_EXTENSION
    - AIS-02: Query active group orders for the same manufacturer; recommend joining if beneficial
    - AIS-03: Block suboptimal paths (low-volume wholesale cheaper as regular; mismatched manufacturer)
    - AIS-04: Enforce price disclosure rules — no prices for CATALOG_EXTENSION, correct tier for ACTIVE_IMPORTED
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 6.3_

  - [x] 4.2 Add Dream List activation flow (AIS-05) to the intervention gate engine
    - Implement `handleDreamListProduct(product, catalogProducts)` — explains Dream List stage, offers wishlist add, suggests ACTIVE_IMPORTED alternatives
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 4.3 Add culinary cross-selling logic (AIS-07) to the intervention gate engine
    - Implement `getCulinaryRecommendations(cookingContext, catalogProducts)` — generates recipe-based recommendations from catalog products only (ground truth)
    - Implement post-order complementary suggestions — after order completion, suggest complementary items and open group orders
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 4.4 Add cart management gate (AIS-08) to the intervention gate engine
    - Implement `validateCartCheckout(cart, orderTypes)` — validates minimum order requirements per order type
    - Return shortfall info and suggest items to reach minimum when validation fails
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 4.5 Write property test: Product state verification always blocks CATALOG_EXTENSION from purchase
    - **Property 1: AIS-01 product state gate invariant**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 5. Implement Order Type Router in `services/orchestrator`
  - [x] 5.1 Create `services/orchestrator/src/ai/orderTypeRouter.ts`
    - Implement `getAvailableOrderTypes(productId, customerId)` — determines available order types based on product metadata, user type, and product state
    - Regular: available for ACTIVE_IMPORTED with retail price
    - Stock: available when product has wholesale price and MOQ metadata
    - Group: available when product has logistics metadata (unitsPerBox, boxesPerLayer, layersPerSurface)
    - Import: available for retailer users when product has logistics metadata
    - CATALOG_EXTENSION: no order types, only Dream List flow
    - Handle missing logistics metadata — exclude Group/Import, explain to user
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 16.1, 16.2_

  - [ ]* 5.2 Write property test: Regular orders always available for ACTIVE_IMPORTED products with retail price
    - **Property 5: Order type availability invariant**
    - **Validates: Requirements 1.5, 16.1**

- [x] 6. Checkpoint — Ensure intervention gates and order type router compile and pass tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Register new tools and wire into the tool executor
  - [x] 7.1 Add new tool definitions to `services/orchestrator/src/ai/tools.ts`
    - Add `get_order_type_options` tool — takes productId, returns available order types with explanations
    - Add `import_order_create` tool — takes customerId, optional deadlineHours
    - Add `import_order_check` tool — takes productId, customerId; returns existing import orders for manufacturer
    - Add `import_add_item` tool — takes code, productId, quantity
    - Add `import_order_status` tool — takes code
    - Add `order_status` tool — takes orderId or code; returns order status with actions (AIS-06)
    - _Requirements: 1.1, 2.1, 2.4, 8.1, 8.2_

  - [x] 7.2 Implement tool handlers in `services/orchestrator/src/ai/toolExecutor.ts`
    - Add handler for `get_order_type_options` — calls intervention gate engine → order type router
    - Add handler for `import_order_create` — calls Import Order Service
    - Add handler for `import_order_check` — queries open import orders for customer/manufacturer
    - Add handler for `import_add_item` — validates single-user constraint, calls allocation engine, returns palette fill progress
    - Add handler for `import_order_status` — returns import order status with palette progress
    - Add handler for `order_status` — returns order status with available actions (AIS-06)
    - Enforce AIS-04 price disclosure in tool executor — strip prices from CATALOG_EXTENSION products before returning to LLM
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.3, 8.1, 8.2, 14.1, 14.2_

- [x] 8. Implement Language Detection and Anti-Spam Guardrails
  - [x] 8.1 Create `services/orchestrator/src/ai/languageHandler.ts`
    - Implement `detectLanguage(text)` — detect Hebrew vs English using Unicode range check (Hebrew: \u0590-\u05FF)
    - Default to Hebrew when ambiguous (mixed input)
    - Implement `getLanguageInstruction(lang)` — returns `[LANGUAGE: he]` or `[LANGUAGE: en]` tag
    - Apply language tag to user message before sending to LLM in the chat loop
    - _Requirements: 12.1, 12.2, 12.4, 12.5_

  - [x] 8.2 Create `services/orchestrator/src/ai/antiSpamGuardrails.ts`
    - Implement `canSuggestShare(sessionContext)` — checks session-level (max 3) and page-level (max 1) limits
    - Implement `recordShareSuggestion(sessionId, page)` — increments counters
    - Server-side validation of anti-spam counters (do not trust client-side values)
    - _Requirements: 13.1, 13.2, 13.3, 13.5_

  - [ ]* 8.3 Write property test: Share suggestions per session never exceed 3, per page never exceed 1
    - **Property 3: Anti-spam guardrail invariant**
    - **Validates: Requirements 13.1, 13.2, 13.3**

- [x] 9. Update System Prompt and Chat Loop for M2 features
  - [x] 9.1 Extend `SystemPromptContext` in `services/orchestrator/src/ai/systemPrompt.ts` with M2 context
    - Add `contextMetadata?: ContextMetadata` to `SystemPromptContext`
    - Add `sessionContext?: SessionContext` to `SystemPromptContext`
    - Update `buildSystemPrompt` to incorporate context metadata (current page, product state, pricing tiers, active orders) into the prompt
    - Add intervention gate instructions (AIS-01 through AIS-08) to the system prompt
    - Add order type selection flow instructions
    - Add anti-spam tone rules (natural, trust-first, no guilt language, no artificial urgency)
    - Add import order instructions and palette fill progress reporting
    - _Requirements: 11.2, 13.4, 1.2, 2.4_

  - [x] 9.2 Update `runChatLoop` in `services/orchestrator/src/ai/chatLoop.ts` to integrate M2 features
    - Apply language detection to user message before building messages array
    - Pass `contextMetadata` from request into `SystemPromptContext`
    - Track `SessionContext` for anti-spam counters across the chat loop
    - Collect import order snapshots from tool results (similar to existing `collectedGroupOrder`)
    - _Requirements: 11.2, 12.2, 13.5_

- [x] 10. Checkpoint — Ensure orchestrator compiles with all new tools and M2 chat loop changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Context Metadata Provider in frontend
  - [x] 11.1 Create context metadata extraction in `apps/web/app/components/`
    - Create a `useContextMetadata` hook or utility that extracts current page, product details, user type, pricing tiers, and active group/import order info
    - Detect current page from Next.js router (catalog, product_detail, cart, checkout, group_orders, profile)
    - Extract product state (ACTIVE_IMPORTED / CATALOG_EXTENSION), manufacturer, and pricing tiers from page data
    - Include active group/import order codes, progress, participant count, and days remaining
    - _Requirements: 11.1, 11.3, 11.4_

  - [x] 11.2 Wire context metadata into the chat message POST request
    - Update the chat UI component to include `contextMetadata` in every POST to `/api/message`
    - Ensure user type (private_consumer / retailer) is passed from auth/session context
    - _Requirements: 11.1, 11.2_

- [x] 12. Implement RTL rendering support in frontend
  - [x] 12.1 Add RTL layout handling to the chat UI in `apps/web/app/components/`
    - Detect Hebrew content in agent responses (check for Hebrew Unicode characters)
    - Apply `dir="rtl"` and right-alignment to Hebrew response bubbles
    - Preserve LTR for English responses and product names in their original catalog language
    - _Requirements: 12.3, 12.5_

- [x] 13. Wire palette overflow and missing metadata error handling
  - [x] 13.1 Add palette overflow handling to import/group order tool handlers in `toolExecutor.ts`
    - When allocation returns `OVERFLOW` error, format response with exact remaining capacity (boxes, layers, surfaces)
    - Offer to fill to maximum available amount
    - _Requirements: 15.1, 15.2_

  - [x] 13.2 Add missing logistics metadata handling to order type router
    - When product lacks `unitsPerBox`, `boxesPerLayer`, or `layersPerSurface`, exclude Group and Import types
    - Return explanation that product is only available for Regular or Stock orders
    - _Requirements: 16.1, 16.2_

- [x] 14. Update intent classifier for M2 intents
  - [x] 14.1 Extend `services/orchestrator/src/intent/classifier.ts` and shared `Intent` type
    - Add new intents: `IMPORT_ORDER`, `ORDER_STATUS`, `DREAM_LIST`, `ORDER_TYPE_SELECT`
    - Add classification patterns for import order requests, order status queries, and Dream List interactions
    - _Requirements: 1.1, 2.1, 7.1, 8.1_

- [x] 15. Ground truth enforcement
  - [x] 15.1 Add ground truth validation to tool executor responses
    - Ensure all product references in tool results come from WooCommerce/HubSpot catalog lookups
    - When product not found, return structured "not found" response with suggestion to search alternative terms
    - Verify system prompt includes ground truth enforcement rules (already partially present in rule #2)
    - _Requirements: 14.1, 14.2, 14.3_

- [x] 16. Final checkpoint — Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Import orders reuse the existing allocation engine — no new allocation code path needed
- The design uses TypeScript throughout, matching the existing codebase
