# Group Order Refactor Plan - Strict Client Rules Implementation

## Current State Analysis

### Existing Data Model
- `GroupOrder`: tracks manufacturer, MOQ target/current, status
- `GroupOrderItem`: tracks quantity per product per customer
- `recalcMoq()`: calculates MOQ based on box quantities and layer completion

### Current Algorithm Issues
1. **No surface/pallet tracking**: Current code tracks boxes but not surfaces
2. **No layer allocation**: Doesn't enforce "one product per layer" rule
3. **No surface_max_layers enforcement**: Doesn't calculate min(layers_per_surface) across products
4. **MOQ is box-based**: Should be surface-based (pallets)
5. **No overflow detection**: Doesn't prevent exceeding capacity
6. **Missing product fields**: Needs `layers_per_surface`, `boxes_per_surface`, `units_per_box`

## New Data Model (Prisma Schema Changes)

### Add to schema.prisma:

```prisma
model GroupOrderSurface {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  groupOrderId String
  groupOrder   GroupOrder @relation(fields: [groupOrderId], references: [id], onDelete: Cascade)

  surfaceIndex Int // 0-based index (surface 1, 2, 3...)
  maxLayers    Int // snapshot of surface_max_layers at creation time
  status       String @default("open") @db.VarChar(32) // open, full, locked

  layers GroupOrderLayer[]

  @@unique([groupOrderId, surfaceIndex])
  @@index([groupOrderId])
}

model GroupOrderLayer {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  surfaceId String
  surface   GroupOrderSurface @relation(fields: [surfaceId], references: [id], onDelete: Cascade)

  layerIndex Int // 0-based index within surface
  productId  String
  variantId  String?

  // Capacity (from product metadata)
  capacityBoxes Int
  capacityUnits Int

  // Current fill
  filledBoxes Int @default(0)
  filledUnits Int @default(0)

  status String @default("open") @db.VarChar(32) // open, full

  // Audit: which customers contributed
  contributions Json? // [{customerId, boxes, units, timestamp}]

  @@unique([surfaceId, layerIndex])
  @@index([surfaceId])
  @@index([productId])
}
```

### Update GroupOrder model:

```prisma
model GroupOrder {
  // ... existing fields ...
  
  // NEW: MOQ in surfaces (pallets), not boxes
  moqSurfaces Int @default(1) // from env GROUP_ORDER_DEFAULT_MOQ_SURFACES
  
  // NEW: Effective max layers per surface (min across all products)
  surfaceMaxLayers Int? // calculated when first product added
  
  // NEW: Relations
  surfaces GroupOrderSurface[]
  
  // KEEP: items for backward compatibility and user-level tracking
  items GroupOrderItem[]
}
```

## Environment Variables

```env
# Default MOQ in surfaces/pallets (default: 1)
GROUP_ORDER_DEFAULT_MOQ_SURFACES=1

# Allow opening more surfaces than MOQ (default: false)
GROUP_ORDER_ALLOW_EXTRA_SURFACES=false

# Max surfaces allowed if extra surfaces enabled (default: 10)
GROUP_ORDER_MAX_SURFACES=10
```

## Algorithm Implementation

### File Structure

```
packages/db/src/
  groupOrder/
    types.ts              # Interfaces and types
    allocation.ts         # Core allocation algorithm (pure logic)
    repository.ts         # DB operations
    service.ts            # Public API (combines allocation + repository)
    validation.ts         # Product metadata validation
    config.ts             # Environment variable loading
```

### Core Algorithm (allocation.ts)

```typescript
/**
 * CLIENT RULE 1: One manufacturer per group order
 * CLIENT RULE 2: Each surface has multiple layers
 * CLIENT RULE 3: One product type per layer
 * CLIENT RULE 4: surface_max_layers = MIN(layers_per_surface) across all products
 * CLIENT RULE 5: Fill existing open layers first before opening new ones
 * CLIENT RULE 6: Layer capacity = boxes_per_layer
 * CLIENT RULE 7: MOQ = minimum surfaces (pallets) required
 */

interface AllocationInput {
  groupOrderId: string;
  customerId: string;
  product: ProductLogistics;
  quantityUnits: number;
}

interface ProductLogistics {
  productId: string;
  variantId?: string;
  manufacturer: string;
  unitsPerBox: number;
  boxesPerLayer: number;
  layersPerSurface: number;
  boxesPerSurface?: number; // derived if missing
}

interface AllocationResult {
  success: boolean;
  allocatedBoxes: number;
  allocatedUnits: number;
  surfacesOpened: number;
  layersOpened: number;
  error?: AllocationError;
}

interface AllocationError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

function allocateToGroupOrder(
  input: AllocationInput,
  currentState: GroupOrderState
): AllocationResult {
  // Step A: Validate manufacturer (CLIENT RULE 1)
  // Step B: Calculate surface_max_layers (CLIENT RULE 4)
  // Step C: Convert units to boxes (wholesale ordering)
  // Step D: Allocate to existing open layers (CLIENT RULE 5)
  // Step E: Open new layers if needed (CLIENT RULE 3)
  // Step F: Open new surfaces if needed (CLIENT RULE 7)
  // Step G: Check overflow conditions
}
```

## Migration Strategy

### Phase 1: Add New Tables (Non-Breaking)
1. Run migration to add `GroupOrderSurface` and `GroupOrderLayer`
2. Keep existing `GroupOrderItem` table
3. Add new fields to `GroupOrder`

### Phase 2: Dual-Write Period
1. New allocation service writes to both old and new tables
2. Old `recalcMoq()` continues to work
3. Gradual rollout with feature flag

### Phase 3: Switch to New Algorithm
1. Enable new allocation service
2. Migrate existing group orders to new structure
3. Deprecate old `recalcMoq()`

### Phase 4: Cleanup
1. Remove old MOQ calculation
2. Keep `GroupOrderItem` for user-level tracking only

## Testing Requirements

### Unit Tests (allocation.ts)
- Single product fills one layer, then opens another
- Multiple products enforce surface_max_layers
- Adding product that reduces surface_max_layers fails
- Overflow detection works correctly
- Manufacturer validation works

### Integration Tests (service.ts)
- Concurrent allocations don't overfill
- Transaction rollback on error
- DB state consistency

### E2E Tests
- Full group order lifecycle
- Payment integration
- Multi-user scenarios

## Backward Compatibility

### Keep Working:
- Existing group order endpoints
- `GroupOrderItem` for user tracking
- Status transitions (DRAFT → OPEN → MOQ_REACHED)

### New Behavior:
- MOQ is now surface-based, not box-based
- Strict layer allocation rules
- Overflow errors instead of silent acceptance

## Rollout Plan

1. **Week 1**: Implement new data model + migration
2. **Week 2**: Implement allocation service + tests
3. **Week 3**: Dual-write integration + testing
4. **Week 4**: Production rollout with monitoring
5. **Week 5**: Migrate existing orders + cleanup

## Files to Create/Modify

### New Files:
- `prisma/migrations/YYYYMMDD_group_order_surfaces_layers.sql`
- `packages/db/src/groupOrder/types.ts`
- `packages/db/src/groupOrder/allocation.ts`
- `packages/db/src/groupOrder/repository.ts`
- `packages/db/src/groupOrder/service.ts`
- `packages/db/src/groupOrder/validation.ts`
- `packages/db/src/groupOrder/config.ts`
- `packages/db/src/groupOrder/index.ts`
- `packages/db/src/groupOrder/__tests__/allocation.test.ts`

### Modified Files:
- `prisma/schema.prisma` (add new models)
- `packages/db/src/index.ts` (export new service)
- `services/orchestrator/src/ai/toolExecutor.ts` (use new service)
- `.env.example` (add new env vars)

## Next Steps

1. Review and approve this plan
2. Create Prisma migration
3. Implement allocation service
4. Add comprehensive tests
5. Integrate with existing endpoints
