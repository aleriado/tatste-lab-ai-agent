# Group Order Refactor - Quick Start Guide

## TL;DR

I've refactored your group order system to implement the strict client rules for surface/layer allocation. The core algorithm is complete and ready for integration.

## What Changed

### Before (Current System)
- Tracks boxes only
- MOQ based on box count
- No surface/pallet tracking
- No layer allocation
- Simple quantity accumulation

### After (New System)
- Tracks surfaces (pallets) and layers
- MOQ based on surface count (configurable via env)
- Enforces "one product per layer" rule
- Calculates `surface_max_layers = MIN(layers_per_surface)` across products
- Fills existing layers before opening new ones
- Prevents overflow with detailed error messages

## Quick Integration Steps

### 1. Add Environment Variables

Add to `.env`:
```env
GROUP_ORDER_DEFAULT_MOQ_SURFACES=1
GROUP_ORDER_ALLOW_EXTRA_SURFACES=false
GROUP_ORDER_MAX_SURFACES=10
```

### 2. Run Database Migration

```bash
cd /path/to/project
pnpm prisma migrate dev --name group_order_surfaces_layers
```

This creates the new `GroupOrderSurface` and `GroupOrderLayer` tables.

### 3. Update Product Metadata Extraction

In `services/orchestrator/src/ai/toolExecutor.ts`, update `productGroupOrderMetadata()`:

```typescript
function productGroupOrderMetadata(product: WooProduct) {
  return {
    manufacturer: product.manufacturer ?? product.metadata?.manufacturer,
    unitsPerBox: product.unitsPerBox ?? (product.metadata?.unitsPerBox as number | undefined) ?? 1,
    boxesPerLayer: product.boxesPerLayer ?? (product.metadata?.boxesPerLayer as number | undefined),
    layersPerSurface: product.layersPerSurface ?? (product.metadata?.layersPerSurface as number | undefined),
    boxesPerSurface: product.boxesPerSurface ?? (product.metadata?.boxesPerSurface as number | undefined)
  };
}
```

### 4. Test the Core Algorithm

The allocation algorithm is in `packages/db/src/groupOrder/allocation.ts`.

It's a pure function you can test immediately:

```typescript
import { allocateToGroupOrder } from './packages/db/src/groupOrder/allocation';

const result = allocateToGroupOrder(
  {
    groupOrderId: 'test',
    customerId: 'user1',
    product: {
      productId: 'prod1',
      name: 'Test Product',
      manufacturer: 'Manufacturer A',
      unitsPerBox: 12,
      boxesPerLayer: 6,
      layersPerSurface: 4
    },
    quantityUnits: 100
  },
  {
    id: 'test',
    code: 'ABC123',
    manufacturerId: null,
    moqSurfaces: 1,
    surfaceMaxLayers: null,
    surfaces: [],
    allowExtraSurfaces: false,
    maxSurfacesLimit: 10
  }
);

console.log(result);
// {
//   success: true,
//   allocatedBoxes: 9, // ceil(100 / 12)
//   allocatedUnits: 108, // 9 * 12
//   surfacesOpened: 1,
//   layersOpened: 2, // 9 boxes / 6 boxes_per_layer = 2 layers
//   ...
// }
```

## Client Rules Mapping

| Rule | Implementation | File |
|------|----------------|------|
| 1. One manufacturer | `validateManufacturer()` | `allocation.ts:95` |
| 2. Multiple layers per surface | `GroupOrderSurface` model | `schema.prisma` |
| 3. One product per layer | `GroupOrderLayer.productId` | `schema.prisma` |
| 4. surface_max_layers = MIN(...) | `calculateSurfaceMaxLayers()` | `allocation.ts:115` |
| 5. Fill existing layers first | `performAllocation()` loop | `allocation.ts:160` |
| 6. Layer capacity | `capacityBoxes/Units` | `schema.prisma` |
| 7. MOQ in surfaces | `moqSurfaces` field | `schema.prisma` |

## Error Codes

The algorithm returns detailed errors:

| Code | Meaning | Action |
|------|---------|--------|
| `MANUFACTURER_MISMATCH` | Product from different manufacturer | Show error to user |
| `INVALID_QUANTITY` | Quantity <= 0 | Validate input |
| `OVERFLOW` | Would exceed surface capacity | Show capacity info |
| `LAYER_LIMIT_CONFLICT` | New product reduces max layers | Explain conflict |
| `MISSING_LOGISTICS` | Product missing required fields | Fix product data |

## Example Error Response

```json
{
  "success": false,
  "error": {
    "code": "OVERFLOW",
    "message": "Cannot allocate 50 more boxes - would exceed MOQ surfaces limit (1)",
    "details": {
      "moqSurfaces": 1,
      "surfaceMaxLayers": 4,
      "currentSurfaces": 1,
      "requestedBoxes": 100,
      "allocatedBoxes": 50,
      "remainingBoxes": 50,
      "allowExtraSurfaces": false
    }
  }
}
```

## What's Next

1. **Implement repository layer** - DB operations with transactions
2. **Implement service layer** - Public API that combines allocation + repository
3. **Write tests** - Unit tests for allocation.ts
4. **Integrate with toolExecutor** - Update group_add_item case
5. **Test end-to-end** - Full group order flow

## Files to Review

### Core Algorithm (Ready)
- ✅ `packages/db/src/groupOrder/allocation.ts` - Main logic
- ✅ `packages/db/src/groupOrder/types.ts` - TypeScript interfaces
- ✅ `packages/db/src/groupOrder/validation.ts` - Product validation
- ✅ `packages/db/src/groupOrder/config.ts` - Environment config

### Schema (Ready)
- ✅ `prisma/schema.prisma` - Updated with new models

### Documentation (Ready)
- ✅ `docs/GROUP_ORDER_REFACTOR_PLAN.md` - Detailed plan
- ✅ `docs/GROUP_ORDER_IMPLEMENTATION_SUMMARY.md` - Complete summary
- ✅ `docs/GROUP_ORDER_QUICK_START.md` - This file

### To Implement
- ⏳ `packages/db/src/groupOrder/repository.ts` - DB operations
- ⏳ `packages/db/src/groupOrder/service.ts` - Public API
- ⏳ `packages/db/src/groupOrder/__tests__/allocation.test.ts` - Tests

## Questions?

Refer to:
1. **This file** - Quick overview
2. **GROUP_ORDER_IMPLEMENTATION_SUMMARY.md** - Complete details
3. **GROUP_ORDER_REFACTOR_PLAN.md** - Original plan
4. **Code comments in allocation.ts** - Rule-by-rule mapping
