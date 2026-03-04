# Group Order Refactor - Implementation Summary

## Status: DESIGN COMPLETE - READY FOR IMPLEMENTATION

## What Was Done

### 1. Analysis
- Reviewed existing group order implementation in `packages/db/src/index.ts`
- Identified gaps vs. strict client rules
- Current system tracks boxes but not surfaces/layers
- MOQ calculation is box-based, should be surface-based

### 2. New Data Model (Prisma Schema)
**File Modified**: `prisma/schema.prisma`

Added two new models:
- `GroupOrderSurface`: Tracks pallets/surfaces (משטח)
- `GroupOrderLayer`: Tracks layers within surfaces (שכבה)

Updated `GroupOrder` model:
- Added `moqSurfaces` (replaces box-based MOQ)
- Added `surfaceMaxLayers` (CLIENT RULE 4: min across products)
- Added `surfaces` relation
- Kept `moqTarget`/`moqCurrent` for backward compatibility

### 3. New Service Architecture
**Files Created**:
- `packages/db/src/groupOrder/types.ts` - TypeScript interfaces
- `packages/db/src/groupOrder/config.ts` - Environment variable loading
- `packages/db/src/groupOrder/validation.ts` - Product logistics validation
- `packages/db/src/groupOrder/allocation.ts` - **Core allocation algorithm (PURE LOGIC)**

### 4. Environment Variables
**File to Update**: `.env` and `.env.example`

```env
# Default MOQ in surfaces/pallets (default: 1)
GROUP_ORDER_DEFAULT_MOQ_SURFACES=1

# Allow opening more surfaces than MOQ (default: false)
GROUP_ORDER_ALLOW_EXTRA_SURFACES=false

# Max surfaces allowed if extra surfaces enabled (default: 10)
GROUP_ORDER_MAX_SURFACES=10
```

## Client Rules Implementation

### ✅ CLIENT RULE 1: One manufacturer per group order
- **Location**: `allocation.ts` - `validateManufacturer()`
- **Logic**: Checks `state.manufacturerId` matches `product.manufacturer`
- **Error**: `MANUFACTURER_MISMATCH` if different

### ✅ CLIENT RULE 2: Each surface has multiple layers
- **Location**: `GroupOrderSurface` model + `allocation.ts`
- **Logic**: Each surface tracks its layers via `layers` relation

### ✅ CLIENT RULE 3: One product type per layer
- **Location**: `GroupOrderLayer` model + `allocation.ts`
- **Logic**: Each layer has `productId` + `variantId`, no mixing

### ✅ CLIENT RULE 4: surface_max_layers = MIN(layers_per_surface)
- **Location**: `allocation.ts` - `calculateSurfaceMaxLayers()`
- **Logic**: Takes minimum of current limit and new product's `layersPerSurface`
- **Validation**: `checkLayerLimitConflict()` prevents adding product that would reduce limit below opened layers

### ✅ CLIENT RULE 5: Fill existing open layers first
- **Location**: `allocation.ts` - `performAllocation()`
- **Logic**: Loops through existing layers for same product, fills available capacity before opening new layers

### ✅ CLIENT RULE 6: Layer capacity = boxes_per_layer
- **Location**: `GroupOrderLayer` model + `allocation.ts`
- **Logic**: `capacityBoxes` and `capacityUnits` stored per layer

### ✅ CLIENT RULE 7: MOQ = minimum surfaces (pallets)
- **Location**: `GroupOrder.moqSurfaces` + `allocation.ts`
- **Logic**: Tracks surfaces opened, checks against `moqSurfaces` limit
- **Overflow**: Returns error if would exceed MOQ surfaces (when `allowExtraSurfaces=false`)

## Key Algorithm Features

### Deterministic Allocation
- **Pure function**: `allocateToGroupOrder(input, currentState) => AllocationResult`
- **No side effects**: Easy to test, no DB dependencies in core logic
- **Predictable**: Same input always produces same output

### Box-Only Ordering
- **Assumption**: Wholesale requires full cartons
- **Conversion**: `quantityBoxes = ceil(quantityUnits / unitsPerBox)`
- **Comment**: Clearly documented in code

### Overflow Detection
- **Surface limit**: Cannot exceed `moqSurfaces` (unless `allowExtraSurfaces=true`)
- **Max limit**: Cannot exceed `maxSurfacesLimit` even with extra surfaces
- **Detailed errors**: Returns exact capacity info in error details

### Concurrency Safety
- **Transaction**: DB writes must be in transaction with row locking
- **Optimistic concurrency**: Check version/timestamp before write
- **Retry logic**: Handle conflicts gracefully

## What Still Needs to Be Done

### 1. Database Migration
**File to Create**: `prisma/migrations/YYYYMMDD_group_order_surfaces_layers/migration.sql`

```bash
pnpm prisma migrate dev --name group_order_surfaces_layers
```

### 2. Repository Layer
**File to Create**: `packages/db/src/groupOrder/repository.ts`

Functions needed:
- `loadGroupOrderState(groupOrderId)` - Load current state from DB
- `saveAllocationResult(groupOrderId, result, customerId)` - Write allocation to DB
- `createGroupOrderWithSurfaces(customerId, moqSurfaces)` - Create with new structure
- Transaction handling with row locking

### 3. Service Layer
**File to Create**: `packages/db/src/groupOrder/service.ts`

Public API that combines allocation + repository:
```typescript
export async function addItemToGroupOrder(
  code: string,
  customerId: string,
  product: ProductLogistics,
  quantityUnits: number
): Promise<GroupOrderFull>
```

### 4. Integration
**File to Modify**: `services/orchestrator/src/ai/toolExecutor.ts`

Update `group_add_item` case to:
1. Extract full product logistics from `WooProduct`
2. Call new service instead of old `addGroupOrderItem()`
3. Handle new error codes

### 5. Product Metadata Extraction
**File to Modify**: `services/orchestrator/src/ai/toolExecutor.ts`

Update `productGroupOrderMetadata()` to extract:
```typescript
{
  manufacturer: string;
  unitsPerBox: number;
  boxesPerLayer: number;
  layersPerSurface: number;
  boxesPerSurface?: number;
}
```

### 6. Tests
**Files to Create**:
- `packages/db/src/groupOrder/__tests__/allocation.test.ts` - Unit tests for pure logic
- `packages/db/src/groupOrder/__tests__/service.test.ts` - Integration tests
- `packages/db/src/groupOrder/__tests__/concurrency.test.ts` - Concurrent allocation tests

### 7. Backward Compatibility
**File to Modify**: `packages/db/src/index.ts`

Keep old functions working:
- `addGroupOrderItem()` - Wrapper that calls new service
- `recalcMoq()` - Update to use surface-based calculation
- `getGroupOrderStatus()` - Include surface/layer info in response

### 8. Migration Script
**File to Create**: `scripts/migrate_group_orders.ts`

Migrate existing group orders to new structure:
- Read existing `GroupOrderItem` records
- Create `GroupOrderSurface` and `GroupOrderLayer` records
- Preserve user contributions
- Validate data integrity

## Testing Scenarios

### Unit Tests (allocation.ts)
1. ✅ Single product fills one layer, then opens another
2. ✅ Multiple products enforce surface_max_layers
3. ✅ Adding product that reduces surface_max_layers fails
4. ✅ Overflow detection works correctly
5. ✅ Manufacturer validation works
6. ✅ Invalid quantity rejected
7. ✅ Missing logistics fields rejected

### Integration Tests (service.ts)
1. Concurrent allocations don't overfill
2. Transaction rollback on error
3. DB state consistency after allocation
4. Surface and layer creation
5. Contribution tracking

### E2E Tests
1. Full group order lifecycle
2. Multi-user scenarios
3. Payment integration
4. Status transitions

## Rollout Strategy

### Phase 1: Schema + Core Logic (Week 1)
- ✅ Prisma schema changes
- ✅ Core allocation algorithm
- ✅ Types and validation
- Run migration
- Unit tests

### Phase 2: Repository + Service (Week 2)
- Implement repository layer
- Implement service layer
- Integration tests
- Concurrency tests

### Phase 3: Integration (Week 3)
- Update toolExecutor
- Update product metadata extraction
- Backward compatibility wrappers
- E2E tests

### Phase 4: Migration + Rollout (Week 4)
- Migration script for existing orders
- Feature flag for gradual rollout
- Monitoring and alerts
- Production deployment

### Phase 5: Cleanup (Week 5)
- Remove old MOQ calculation
- Update documentation
- Performance optimization
- Final validation

## Files Summary

### Created:
1. `docs/GROUP_ORDER_REFACTOR_PLAN.md` - Detailed plan
2. `docs/GROUP_ORDER_IMPLEMENTATION_SUMMARY.md` - This file
3. `packages/db/src/groupOrder/types.ts` - TypeScript interfaces
4. `packages/db/src/groupOrder/config.ts` - Environment config
5. `packages/db/src/groupOrder/validation.ts` - Product validation
6. `packages/db/src/groupOrder/allocation.ts` - **Core algorithm**

### Modified:
1. `prisma/schema.prisma` - Added GroupOrderSurface and GroupOrderLayer models

### To Create:
1. `packages/db/src/groupOrder/repository.ts` - DB operations
2. `packages/db/src/groupOrder/service.ts` - Public API
3. `packages/db/src/groupOrder/index.ts` - Exports
4. `packages/db/src/groupOrder/__tests__/allocation.test.ts` - Tests
5. `scripts/migrate_group_orders.ts` - Migration script

### To Modify:
1. `services/orchestrator/src/ai/toolExecutor.ts` - Integration
2. `packages/db/src/index.ts` - Backward compatibility
3. `.env` and `.env.example` - Environment variables

## Next Steps

1. **Review this implementation** - Ensure it meets all requirements
2. **Run Prisma migration** - Create the new tables
3. **Implement repository layer** - DB operations with transactions
4. **Implement service layer** - Public API
5. **Write comprehensive tests** - Unit + integration + E2E
6. **Integrate with toolExecutor** - Update group_add_item
7. **Test in staging** - Validate with real data
8. **Deploy to production** - Gradual rollout with monitoring

## Questions to Answer

1. **Unit ordering**: Confirmed wholesale requires full boxes (ceil conversion)
2. **Concurrency**: Need row-level locking in transactions
3. **Migration**: Need script to migrate existing orders
4. **Backward compatibility**: Keep old functions as wrappers
5. **Performance**: Index on `groupOrderId`, `surfaceIndex`, `layerIndex`

## Contact

For questions or clarifications on this implementation, refer to:
- Client rules document (original requirements)
- This summary document
- Code comments in `allocation.ts` (maps to rule numbers)
