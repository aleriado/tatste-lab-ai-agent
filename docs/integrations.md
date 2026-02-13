# Integrations (M1)

This document describes how WooCommerce and HubSpot integrations work in the Taste Labs orchestrator, and how to switch between adapter modes.

## Why adapter-based integrations?

- **Speed**: MCP (Model Context Protocol) adapters reduce moving parts—one integration surface for WordPress/Woo and (test mode) HubSpot.
- **Fewer moving parts**: Flows call a stable interface and do not know whether the backend is MCP, REST, or mock/stub.
- **Swappable**: You can run the demo without any external credentials (mock + stub), or plug in real Woo/HubSpot via MCP or REST.

## WooCommerce

- **Primary for M1**: WordPress/WooCommerce **MCP adapter**.
- **Modes**: `INTEGRATION_MODE_WOO = mcp | rest | mock`
  - **mcp**: Use MCP client to call WordPress/Woo endpoints. Requires `MCP_WP_BASE_URL` (and optionally `MCP_WP_TOKEN`).
  - **rest**: Direct WooCommerce REST API (optional; implement if needed).
  - **mock**: In-memory catalog. Used when MCP is not configured or as fallback when MCP calls fail.

**Stable interface (used by flows):**

- `searchProducts(query: string)` → list of products (id, name, price?, permalink?)
- `getProduct(productId: string)` → single product

Cart for M1 is kept in thread `contextJson`; no Woo cart API required for the demo.

**Env vars:**

| Variable            | Description                    |
|---------------------|--------------------------------|
| `INTEGRATION_MODE_WOO` | `mcp` \| `rest` \| `mock` (default: `mock` if MCP env missing) |
| `MCP_WP_BASE_URL`  | Base URL of the WordPress/Woo MCP service |
| `MCP_WP_TOKEN`     | Optional auth token for MCP requests      |

---

## HubSpot

- **Test mode**: HubSpot **MCP** is in test mode with minimal time spent; fallback path (REST or stub) keeps flows working.
- **Modes**: `INTEGRATION_MODE_HUBSPOT = mcp | rest | stub`
  - **rest**: Use HubSpot REST API with `HUBSPOT_ACCESS_TOKEN`. Upsert contact + create/update deal.
  - **mcp**: MCP test-mode wrapper. If not configured, falls back to stub.
  - **stub**: Logs intended actions and returns fake IDs. Stores fake IDs in `CrmLink` so the demo does not break.

**Stable interface (used by flows):**

- `upsertContact({ email?, phone?, externalId? })` → `{ contactId }`
- `createOrUpdateDeal({ contactId, title, stage?, meta? })` → `{ dealId }`

**Selector rules:**

- If `INTEGRATION_MODE_HUBSPOT=rest` and `HUBSPOT_ACCESS_TOKEN` is set → use REST adapter.
- If `=mcp` → use MCP adapter (test mode); if MCP not configured, fall back to stub.
- If `=stub` or credentials missing → use stub.

**Env vars:**

| Variable                  | Description                          |
|---------------------------|--------------------------------------|
| `INTEGRATION_MODE_HUBSPOT`| `mcp` \| `rest` \| `stub`             |
| `HUBSPOT_ACCESS_TOKEN`    | Private app token (for REST)          |
| `HUBSPOT_PIPELINE_ID`     | Optional pipeline for new deals      |
| `HUBSPOT_STAGE_ID`        | Optional stage for new deals         |

---

## Flow wiring

- **Woo**: Recommend and Add-to-cart flows import the Woo adapter from `adapters/woocommerce` and call `searchProducts` / `getProduct` only. No flow imports MCP or REST directly.
- **HubSpot**: Orchestrator calls the HubSpot adapter for RECOMMEND and ADD_TO_CART intents (upsert contact + create/update deal) and persists IDs via `upsertCrmLink`. No flow imports MCP/REST/stub directly.

## Demo without MCP

- **Woo**: Set `INTEGRATION_MODE_WOO=mock` or leave MCP env unset → recommendation flow uses mock catalog.
- **HubSpot**: Set `INTEGRATION_MODE_HUBSPOT=stub` or leave token unset → HubSpot writes are stubbed; fake IDs are stored in `CrmLink` so the demo runs end-to-end.
