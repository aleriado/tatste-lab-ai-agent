# Requirements Document

## Introduction

TasteLabs Agent M2 extends the existing conversational commerce agent into a context-aware, multi-order-type shopping assistant. The system supports four order types (Regular, Stock, Group, Import), enforces intervention logic gates (AIS-01 through AIS-08) to guide optimal purchase paths, provides proactive culinary cross-selling, operates in Hebrew-first with RTL support, and includes anti-spam guardrails. All features integrate into the existing monorepo architecture and tool-calling chat loop.

## Glossary

- **Agent**: The conversational AI assistant powered by gpt-4.1-mini that guides users through the shopping experience via the tool-calling chat loop
- **Orchestrator**: The Express-based backend service (`services/orchestrator`) that manages the chat loop, tool execution, and intervention gate evaluation
- **Intervention_Gate_Engine**: The component that evaluates AIS-01 through AIS-08 protocols before the Agent recommends purchase paths
- **Order_Type_Router**: The component that determines which order types are available for a given product and user, and presents type-specific options
- **Import_Order_Service**: The component that manages single-user palette-based import orders for restaurants and supermarkets, reusing the group order allocation engine
- **Context_Metadata_Provider**: The frontend component that enriches every agent request with page-level, product-level, and user-level context
- **Language_Handler**: The component that detects conversation language and ensures Hebrew responses use RTL alignment
- **Anti_Spam_Guardrails**: The component that enforces session-level limits on share suggestions and prevents pressure tactics
- **Allocation_Engine**: The existing engine that manages surface/layer allocation for group and import orders
- **Regular_Order**: An order with no minimum order quantity, using retail pricing
- **Stock_Order**: An order with a minimum order quantity (MOQ), using discounted wholesale pricing
- **Group_Order**: A multi-user palette-based order where participants share surface/layer allocation toward filling a palette
- **Import_Order**: A single-user palette-based order following the same palette rules as Group_Order, intended for restaurants and supermarkets
- **ACTIVE_IMPORTED**: A product state indicating the product is available for purchase with established pricing
- **CATALOG_EXTENSION**: A product state indicating the product is on the Dream List and not yet available for direct purchase
- **Dream_List**: The collection of CATALOG_EXTENSION products that users can express interest in to progress toward import activation
- **Surface**: A physical palette unit used in group and import order allocation
- **Layer**: A subdivision of a Surface, composed of boxes stacked on the palette
- **MOQ**: Minimum Order Quantity — the smallest quantity a user must order for Stock, Group, or Import order types
- **Session_Context**: The per-request state object tracking anti-spam counters, active orders, cooking context, and last intervention gate triggered
- **Ground_Truth**: The principle that all product data must originate from database-backed catalog lookups (WooCommerce/HubSpot), never invented by the Agent

## Requirements

### Requirement 1: Order Type Selection Flow

**User Story:** As a user, I want to see all available order types for a product when I add it to my cart, so that I can choose the purchase path that best fits my needs.

#### Acceptance Criteria

1. WHEN a user initiates adding a product to cart, THE Order_Type_Router SHALL determine and present all available order types for that product and user combination
2. WHEN presenting order type options, THE Agent SHALL provide a brief explanation of each available type including pricing, quantity constraints, and process differences
3. WHEN a user selects an order type, THE Agent SHALL guide the user through the type-specific options and quantity selection for that order type
4. WHILE a product has state CATALOG_EXTENSION, THE Order_Type_Router SHALL exclude all purchase order types and present only the Dream List activation flow
5. WHEN a product has state ACTIVE_IMPORTED and a retail price, THE Order_Type_Router SHALL include Regular as an available order type
6. WHEN a product has wholesale price and MOQ metadata, THE Order_Type_Router SHALL include Stock as an available order type
7. WHEN a product has logistics metadata (unitsPerBox, boxesPerLayer, layersPerSurface), THE Order_Type_Router SHALL include Group as an available order type
8. WHEN a retailer user views a product with logistics metadata, THE Order_Type_Router SHALL include Import as an available order type in addition to other eligible types

### Requirement 2: Import Order Management

**User Story:** As a restaurant or supermarket owner, I want to place import orders that fill a full palette for a single user, so that I can purchase at import pricing without coordinating with other buyers.

#### Acceptance Criteria

1. WHEN a retailer user creates an import order, THE Import_Order_Service SHALL create a group order record with `isImport: true` and `maxParticipants: 1`
2. WHEN a user adds items to an import order, THE Import_Order_Service SHALL use the existing Allocation_Engine to allocate units to surfaces and layers
3. WHEN a second user attempts to add items to an import order, THE Import_Order_Service SHALL reject the request and suggest creating a group order or a separate import order
4. WHEN items are added to an import order, THE Agent SHALL report palette fill progress including boxes filled, surfaces used, and remaining capacity
5. WHEN a user has an existing open import order for the same manufacturer, THE Import_Order_Service SHALL present the existing order and offer to add items to it
6. THE Import_Order_Service SHALL enforce the same manufacturer constraint as group orders, restricting each import order to products from a single manufacturer

### Requirement 3: Intervention Gate — Product State Verification (AIS-01)

**User Story:** As a user, I want the agent to verify product availability before suggesting purchase paths, so that I am not led toward purchasing unavailable products.

#### Acceptance Criteria

1. WHEN a user requests to purchase a product, THE Intervention_Gate_Engine SHALL verify the product state (ACTIVE_IMPORTED or CATALOG_EXTENSION) before presenting order options
2. WHEN a product has state CATALOG_EXTENSION, THE Intervention_Gate_Engine SHALL block purchase paths and redirect the user to the Dream List activation flow (AIS-05)
3. WHEN a product has state ACTIVE_IMPORTED, THE Intervention_Gate_Engine SHALL allow the order type selection flow to proceed

### Requirement 4: Intervention Gate — Group Order Recommendation (AIS-02)

**User Story:** As a user, I want the agent to inform me about active group orders for the same manufacturer, so that I can benefit from group pricing when available.

#### Acceptance Criteria

1. WHEN a user initiates a purchase and active group orders exist for the same manufacturer, THE Intervention_Gate_Engine SHALL recommend joining the group order and show progress and potential savings
2. WHEN the user declines the group order recommendation, THE Intervention_Gate_Engine SHALL allow the user to proceed with the originally selected order type

### Requirement 5: Intervention Gate — Suboptimal Path Blocking (AIS-03)

**User Story:** As a user, I want the agent to prevent me from making suboptimal purchase decisions, so that I get the best value for my orders.

#### Acceptance Criteria

1. WHEN a user attempts a low-volume wholesale purchase that would be cheaper as a regular order, THE Intervention_Gate_Engine SHALL redirect the user to the more cost-effective order type
2. WHEN a user attempts to join a group order that does not match the product manufacturer, THE Intervention_Gate_Engine SHALL block the action and explain the manufacturer constraint

### Requirement 6: Intervention Gate — Price Disclosure Rules (AIS-04)

**User Story:** As a user, I want to see clear and accurate pricing for available products, so that I can make informed purchase decisions.

#### Acceptance Criteria

1. WHILE a product has state CATALOG_EXTENSION, THE Agent SHALL never disclose any pricing information for that product
2. WHEN presenting order options for an ACTIVE_IMPORTED product, THE Agent SHALL display the correct price tier for the selected order type (retail for Regular, wholesale for Stock, import pricing for Group/Import)
3. THE Orchestrator SHALL enforce price disclosure rules in the tool executor before returning data to the LLM, preventing accidental price leaks for CATALOG_EXTENSION products

### Requirement 7: Intervention Gate — Dream List Activation (AIS-05)

**User Story:** As a user, I want to understand the Dream List process and what is needed to progress a product toward availability, so that I can contribute to activating products I want.

#### Acceptance Criteria

1. WHEN a user interacts with a CATALOG_EXTENSION product, THE Agent SHALL explain the product's current Dream List stage and what actions are needed to progress
2. WHEN a user wants to support a Dream List product, THE Agent SHALL offer to add the product to the user's Dream List wishlist
3. WHEN a Dream List product has similar ACTIVE_IMPORTED alternatives, THE Agent SHALL suggest those alternatives to the user

### Requirement 8: Intervention Gate — Order Status (AIS-06)

**User Story:** As a user, I want to query the status of my orders and see available actions, so that I can track and manage my purchases.

#### Acceptance Criteria

1. WHEN a user queries order status, THE Agent SHALL retrieve and display the current status, items, and available actions for the specified order
2. WHEN displaying group or import order status, THE Agent SHALL include palette fill progress, participant count (for group orders), and days remaining

### Requirement 9: Proactive Culinary Cross-Selling (AIS-07)

**User Story:** As a user, I want the agent to suggest complementary products based on my cooking context, so that I can discover relevant items I might need.

#### Acceptance Criteria

1. WHEN a user mentions a cooking context or recipe, THE Intervention_Gate_Engine SHALL generate culinary recommendations from the product catalog that complement the described dish
2. WHEN recommending products, THE Agent SHALL base recommendations only on products available in the catalog (Ground_Truth enforcement)
3. WHEN an order is completed, THE Agent SHALL suggest complementary items and open group orders relevant to the purchased products

### Requirement 10: Intervention Gate — Cart Management (AIS-08)

**User Story:** As a user, I want the agent to manage my cart with total calculation and minimum order validation, so that I can proceed to checkout with confidence.

#### Acceptance Criteria

1. WHEN a user requests cart summary, THE Agent SHALL display all cart items with quantities, per-item pricing, and cart total
2. WHEN a user attempts to checkout, THE Intervention_Gate_Engine SHALL validate that minimum order requirements are met for each order type in the cart
3. IF minimum order requirements are not met, THEN THE Agent SHALL inform the user of the shortfall and suggest items to reach the minimum

### Requirement 11: Context-Aware Agent Initialization

**User Story:** As a user, I want the agent to understand my current page and product context without me having to explain it, so that conversations are efficient and relevant.

#### Acceptance Criteria

1. WHEN a message is sent to the Orchestrator, THE Context_Metadata_Provider SHALL include current page, product details, user type, pricing tiers, and active group order information
2. WHEN the Orchestrator receives context metadata, THE Orchestrator SHALL incorporate the metadata into the system prompt for the LLM without requiring additional database lookups
3. WHEN a user is on a product detail page, THE Context_Metadata_Provider SHALL include the product's state, manufacturer, and all available pricing tiers
4. WHEN a user has active group or import orders, THE Context_Metadata_Provider SHALL include order codes, progress, participant count, and days remaining

### Requirement 12: Language Detection and RTL Support

**User Story:** As a Hebrew-speaking user, I want the agent to respond in Hebrew with proper RTL formatting, so that the conversation feels natural and readable.

#### Acceptance Criteria

1. WHEN a user sends a message, THE Language_Handler SHALL detect whether the input language is Hebrew or English
2. WHEN Hebrew is detected, THE Language_Handler SHALL prepend a `[LANGUAGE: he]` instruction tag to the message sent to the LLM
3. WHEN the Agent responds in Hebrew, THE Frontend SHALL render the response with `dir="rtl"` and right-alignment
4. WHEN language detection is ambiguous due to mixed Hebrew and English input, THE Language_Handler SHALL default to Hebrew
5. THE Agent SHALL preserve product names in their original catalog language regardless of the conversation language

### Requirement 13: Anti-Spam and Anti-Pressure Guardrails

**User Story:** As a user, I want the agent to suggest sharing and group orders without being pushy or repetitive, so that I trust the agent and feel comfortable using it.

#### Acceptance Criteria

1. THE Anti_Spam_Guardrails SHALL enforce a maximum of 3 share suggestions per session
2. THE Anti_Spam_Guardrails SHALL enforce a maximum of 1 share suggestion per page within a session
3. WHEN the share suggestion limit is reached, THE Agent SHALL stop suggesting shares for the remainder of the session or page
4. THE Agent SHALL use natural, trust-first tone without guilt language or artificial urgency in all responses
5. THE Orchestrator SHALL validate anti-spam counters server-side to prevent client-side manipulation

### Requirement 14: Ground Truth Enforcement

**User Story:** As a user, I want the agent to only reference real products from the catalog, so that I can trust the information and recommendations I receive.

#### Acceptance Criteria

1. THE Agent SHALL base all product references, pricing, and availability information on data retrieved from WooCommerce and HubSpot catalog lookups
2. THE Agent SHALL never invent or fabricate product names, prices, or availability information
3. WHEN the Agent cannot find a requested product in the catalog, THE Agent SHALL inform the user that the product was not found and suggest searching with alternative terms

### Requirement 15: Palette Overflow Handling

**User Story:** As a user placing a group or import order, I want to be informed when my requested quantity exceeds palette capacity, so that I can adjust my order accordingly.

#### Acceptance Criteria

1. WHEN a user attempts to add more units than the remaining palette capacity allows, THE Allocation_Engine SHALL reject the addition and report the remaining capacity
2. WHEN a palette overflow occurs, THE Agent SHALL display the exact remaining capacity in boxes and layers and offer to fill to the maximum available amount

### Requirement 16: Missing Logistics Metadata Handling

**User Story:** As a user, I want to understand why certain order types are unavailable for a product, so that I can choose an appropriate alternative.

#### Acceptance Criteria

1. WHEN a product lacks logistics metadata (unitsPerBox, boxesPerLayer, layersPerSurface), THE Order_Type_Router SHALL exclude Group and Import order types for that product
2. WHEN Group or Import order types are excluded due to missing metadata, THE Agent SHALL explain that the product is only available for Regular or Stock orders and suggest those alternatives
