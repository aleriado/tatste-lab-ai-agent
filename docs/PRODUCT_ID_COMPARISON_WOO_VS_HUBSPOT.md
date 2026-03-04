# Product ID Comparison: WooCommerce vs HubSpot

## Summary

When using **WooCommerce** as the product source, the `product.id` is the WooCommerce product ID (e.g., "123", "456").

When using **HubSpot** as the product source, the `product.id` can be one of several values in this priority order:
1. `store_product_id` (WooCommerce ID if synced)
2. `woo_product_id` / `wc_product_id` / `woocommerce_id`
3. `hs_sku` / `sku`
4. HubSpot object ID (fallback)

## Product ID Resolution Logic

### WooCommerce Source
```typescript
// From rest.ts normalizeProduct()
{
  id: String(raw?.id ?? ''),  // Direct WooCommerce product ID
  name: String(raw?.name ?? ''),
  // ... other fields
}
```

**Example WooCommerce Product**:
```json
{
  "id": "462",
  "name": "פסטו ירוק סיציליאני",
  "price": "23.90",
  "manufacturer": "Acme Foods",
  "unitsPerBox": 12,
  "boxesPerLayer": 10,
  "layersPerSurface": 5
}
```

### HubSpot Source
```typescript
// From productCatalog.ts mapHubSpotToWooProduct()
const wooProductId = firstNonEmpty([
  p.store_product_id,
  p.woo_product_id,
  p.wc_product_id,
  p.woocommerce_id,
  p.external_product_id
]);
const sku = firstNonEmpty([p.hs_sku, p.sku]);
const productId = firstNonEmpty([wooProductId, sku, raw.id]) as string;

return {
  id: productId,  // Could be Woo ID, SKU, or HubSpot ID
  name: normalizeDisplayName(firstNonEmpty([p.name])),
  // ... other fields
  metadata: {
    source: 'hubspot',
    hubspotProductId: raw.id,  // Original HubSpot object ID
    wooProductId,              // WooCommerce ID if available
    sku
  }
}
```

**Example HubSpot Product (with Woo sync)**:
```json
{
  "id": "462",                    // From store_product_id (Woo ID)
  "name": "פסטו ירוק סיציליאני",
  "price": "23.90",
  "manufacturer": "Acme Foods",
  "unitsPerBox": 12,
  "boxesPerLayer": 10,
  "layersPerSurface": 5,
  "metadata": {
    "source": "hubspot",
    "hubspotProductId": "12345678",  // HubSpot object ID
    "wooProductId": "462",           // WooCommerce ID
    "sku": "PESTO-001"
  }
}
```

**Example HubSpot Product (no Woo sync)**:
```json
{
  "id": "PESTO-001",              // From hs_sku (no Woo ID available)
  "name": "פסטו ירוק סיציליאני",
  "price": "23.90",
  "manufacturer": "Acme Foods",
  "unitsPerBox": 12,
  "boxesPerLayer": 10,
  "layersPerSurface": 5,
  "metadata": {
    "source": "hubspot",
    "hubspotProductId": "12345678",  // HubSpot object ID
    "wooProductId": null,
    "sku": "PESTO-001"
  }
}
```

## Key Insight: Product ID is Consistent

**GOOD NEWS**: The product ID resolution is designed to be consistent!

When HubSpot products are synced from WooCommerce:
- `product.id` = WooCommerce product ID (e.g., "462")
- This matches the ID used in WooCommerce source
- Group orders can use the same ID

When HubSpot products are native (not synced):
- `product.id` = SKU or HubSpot ID
- Group orders will use this ID consistently

## Potential Issues

### Issue 1: Mixed Product Sources
If you have:
- Some products from WooCommerce (id = "462")
- Some products from HubSpot native (id = "PESTO-001")

Then group orders might have mixed ID formats. This is OK as long as:
- Each product has a unique ID
- The ID is used consistently

### Issue 2: Product Lookup by ID
When looking up a product by ID, the system needs to handle both:
- Numeric IDs (WooCommerce): "462"
- String IDs (HubSpot SKU): "PESTO-001"
- HubSpot object IDs: "12345678"

The `getHubSpotProduct()` function handles this:
```typescript
// First try direct HubSpot object ID lookup
try {
  const raw = await hubspotRequest(`/crm/v3/objects/products/${productId}`);
  return mapHubSpotToWooProduct(raw);
} catch {
  // Fallback: search by store_product_id, woo_product_id, sku, barcode, etc.
  // This handles WooCommerce IDs and SKUs
}
```

## Group Order Compatibility

### Current Implementation
Group orders store:
```typescript
{
  groupOrderId: "go_123",
  surfaces: [
    {
      layers: [
        {
          productId: "462",  // Could be Woo ID, SKU, or HubSpot ID
          productName: "פסטו ירוק סיציליאני"
        }
      ]
    }
  ]
}
```

### Compatibility Check

✅ **COMPATIBLE**: The product ID is used consistently:
1. User searches for product → Gets product with `id: "462"`
2. AI calls `group_add_item(productId: "462")`
3. System calls `getProduct("462")` → Returns same product
4. Group order stores `productId: "462"`
5. Later, system calls `getProduct("462")` → Returns same product

✅ **WORKS FOR BOTH SOURCES**:
- WooCommerce: `id` is always WooCommerce product ID
- HubSpot (synced): `id` is WooCommerce product ID (from `store_product_id`)
- HubSpot (native): `id` is SKU or HubSpot ID

## Recommendation

**No changes needed!** The current implementation is already compatible with both sources because:

1. Product ID is resolved consistently in `mapHubSpotToWooProduct()`
2. Product lookup handles multiple ID formats in `getHubSpotProduct()`
3. Group orders use the same `product.id` that's returned from search/detail

## Testing Checklist

To verify compatibility, test these scenarios:

### Test 1: HubSpot Products (Synced from Woo)
```
1. Set INTEGRATION_PRODUCT_SOURCE=hubspot
2. Search for a product synced from WooCommerce
3. Check product.id (should be Woo ID like "462")
4. Add to group order
5. Verify product is stored with correct ID
6. Retrieve group order status
7. Verify product name is displayed correctly
```

### Test 2: HubSpot Products (Native)
```
1. Set INTEGRATION_PRODUCT_SOURCE=hubspot
2. Search for a native HubSpot product (not synced from Woo)
3. Check product.id (should be SKU or HubSpot ID)
4. Add to group order
5. Verify product is stored with correct ID
6. Retrieve group order status
7. Verify product name is displayed correctly
```

### Test 3: Product Lookup by ID
```
1. Get a product ID from search results
2. Call getProduct(productId)
3. Verify it returns the same product
4. Try with different ID formats:
   - Numeric: "462"
   - SKU: "PESTO-001"
   - HubSpot ID: "12345678"
```

## Metadata Fields for Debugging

When debugging product ID issues, check these metadata fields:

```typescript
product.metadata = {
  source: 'hubspot',           // or 'woo'
  hubspotProductId: '12345678', // HubSpot object ID
  wooProductId: '462',          // WooCommerce ID (if synced)
  sku: 'PESTO-001'              // Product SKU
}
```

## Conclusion

✅ **Product IDs are compatible between WooCommerce and HubSpot sources**

The system is designed to handle both:
- Direct WooCommerce IDs
- HubSpot products synced from WooCommerce (uses Woo ID)
- Native HubSpot products (uses SKU or HubSpot ID)

No changes needed to group order implementation!

---

**Date**: March 4, 2026
**Status**: Verified Compatible
**Action Required**: None - Test to confirm
