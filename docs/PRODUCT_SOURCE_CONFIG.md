# Product Source Configuration

The orchestrator supports two product catalog sources: **HubSpot** and **WooCommerce**.

## Configuration

Set the product source using the `INTEGRATION_PRODUCT_SOURCE` environment variable:

```env
# Use HubSpot as the product catalog source
INTEGRATION_PRODUCT_SOURCE=hubspot

# OR use WooCommerce as the product catalog source
INTEGRATION_PRODUCT_SOURCE=woo
```

## Strict Source Isolation

The system enforces **strict source isolation** - products are NEVER mixed between sources:

- When `INTEGRATION_PRODUCT_SOURCE=hubspot`:
  - All product searches query HubSpot only
  - All product details come from HubSpot only
  - All cross-sell/related products come from HubSpot only
  - Products are filtered to ensure `metadata.source === 'hubspot'`
  - No fallback to WooCommerce

- When `INTEGRATION_PRODUCT_SOURCE=woo`:
  - All product searches query WooCommerce only
  - All product details come from WooCommerce only
  - All cross-sell/related products come from WooCommerce only
  - No fallback to HubSpot

## Required Environment Variables

### For HubSpot Source

```env
INTEGRATION_PRODUCT_SOURCE=hubspot
INTEGRATION_MODE_WOO=rest
HUBSPOT_PRODUCTS_ACCESS_TOKEN=pat-eu1-xxxxx
HUBSPOT_PRODUCTS_MAX_FETCH=500  # Optional, defaults to 500
```

### For WooCommerce Source

```env
INTEGRATION_PRODUCT_SOURCE=woo
INTEGRATION_MODE_WOO=rest
WOO_BASE_URL=https://your-site.com
WOO_CONSUMER_KEY=ck_xxxxx
WOO_CONSUMER_SECRET=cs_xxxxx
```

## How It Works

1. **Adapter Selection**: The `getWooAdapter()` function in `services/orchestrator/src/adapters/woocommerce/index.ts` creates a REST adapter when `INTEGRATION_MODE_WOO=rest`.

2. **Source Detection**: The REST adapter checks `INTEGRATION_PRODUCT_SOURCE` to determine which backend to query.

3. **Strict Filtering**: 
   - HubSpot products are tagged with `metadata.source = 'hubspot'`
   - All search results are filtered to ensure they match the configured source
   - Cross-sell suggestions only include products from the same source

4. **No Mixing**: There is no fallback between sources. If HubSpot returns no results, the system returns an empty array rather than falling back to WooCommerce.

## Debugging

The system logs product source information:

```
[info] Catalog adapter: REST (source=hubspot)
[info] HubSpot product search: fetched 18 products
[info] Returning 18 HubSpot products after filtering
```

If you see products from the wrong source, check:

1. The `INTEGRATION_PRODUCT_SOURCE` environment variable
2. The orchestrator startup logs for "Catalog adapter: REST (source=...)"
3. Clear the adapter cache by restarting the orchestrator
4. Check product `metadata.source` field in the response

## Cache Behavior

The REST adapter caches product searches for 5 minutes. If you change the product source:

1. Restart the orchestrator to clear the cache
2. Or wait 5 minutes for the cache to expire

## Product Type Alignment

All products follow the canonical spreadsheet structure with fields:
- `manufacturer` (יצרן) - manufacturer name
- `inventory` (מלאי) - current stock
- `costPrice`, `importPricePerSurface`, `importPricePer2Boxes`, `wholesalePrice`, `retailPrice`, `salePrice`
- `status`, `isDownloadable`, `downloadLink`, `subCategory`, `tags`
- `unitsPerBox`, `boxesPerLayer`, `layersPerSurface`, `boxesPerSurface`

Both HubSpot and WooCommerce products are normalized to this structure.
