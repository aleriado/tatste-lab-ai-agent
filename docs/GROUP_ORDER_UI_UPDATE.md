# Group Order UI Update - Detailed Surface & Layer Display

## Summary

Updated the web frontend to show detailed group order information with surfaces, layers, and product allocation details.

## What Was Changed

### 1. Backend - Enhanced Data Structure

**File**: `packages/db/src/index.ts`

- Updated `getGroupOrderStatus()` to include surface and layer data
- Added `surfaces` array with full layer details
- Added product names to layers (mapped from items)
- Added `moqSurfaces` and `surfaceMaxLayers` fields

**New Fields in GroupOrderFull**:
```typescript
{
  moqSurfaces: number;
  surfaceMaxLayers: number | null;
  surfaces?: {
    surfaceIndex: number;
    maxLayers: number;
    status: string;
    layers: {
      layerIndex: number;
      productId: string;
      productName: string;
      variantId: string | null;
      capacityBoxes: number;
      capacityUnits: number;
      filledBoxes: number;
      filledUnits: number;
      status: string;
    }[];
  }[];
}
```

### 2. Shared Types - Updated Interface

**File**: `packages/shared/src/index.ts`

- Updated `GroupOrderSnapshot` to include `moqSurfaces`, `surfaceMaxLayers`, and `surfaces`
- Added product name to layer interface

### 3. Orchestrator - Pass New Data

**File**: `services/orchestrator/src/ai/chatLoop.ts`

- Updated to pass `moqSurfaces`, `surfaceMaxLayers`, and `surfaces` to frontend

### 4. Frontend Component - Complete Redesign

**File**: `apps/web/app/components/GroupOrderStatus.tsx`

Completely redesigned to show three states:

#### State 1: No Products Added Yet
```
┌─────────────────────────────────┐
│ MOQ Configuration               │
│ MOQ Surfaces: 1 pallet          │
│ Add products to start filling   │
└─────────────────────────────────┘
```

#### State 2: Products Added (New Algorithm)
```
┌─────────────────────────────────────────┐
│ Surfaces & Layers                       │
│ (Max 4 layers per surface)              │
│ MOQ: 1 surface (pallet)                 │
│                                         │
│ ┌─ Surface 1 ──────────── [open] ─┐   │
│ │                                   │   │
│ │ ┌─ Layer 1 ────────── [full] ─┐ │   │
│ │ │ Product: Tomato Paste        │ │   │
│ │ │ 12 units (1 box)             │ │   │
│ │ │ Capacity: 1 box              │ │   │
│ │ └──────────────────────────────┘ │   │
│ │                                   │   │
│ │ ┌─ Layer 2 ────────── [open] ─┐ │   │
│ │ │ Product: Olive Oil           │ │   │
│ │ │ 17 units (2 boxes)           │ │   │
│ │ │ Capacity: 10 boxes           │ │   │
│ │ └──────────────────────────────┘ │   │
│ │                                   │   │
│ └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

#### State 3: Fallback (Old Data Format)
```
┌─────────────────────────────────┐
│ Products Added                  │
│ MOQ: 1 surface                  │
│                                 │
│ Product 1: prod_123             │
│ 12 units (1 box)                │
│                                 │
│ Product 2: prod_456             │
│ 17 units (2 boxes)              │
└─────────────────────────────────┘
```

### 5. Styling - New CSS Classes

**File**: `apps/web/app/globals.css`

Added comprehensive styling for:
- `.group-order-moq-card` - MOQ display when no products
- `.group-order-surfaces-card` - Container for surfaces
- `.group-order-surface` - Individual surface/pallet
- `.group-order-layer` - Individual layer within surface
- `.group-order-layer-status` - Status badges (open/full)
- `.group-order-surface-status` - Surface status badges

## Display Logic

### When to Show What

1. **No products added** (`!hasSurfaces && !hasItems`)
   - Show MOQ configuration card
   - Display: "MOQ Surfaces: 1 pallet"
   - Hint: "Add products to start filling"

2. **Products added with new algorithm** (`hasSurfaces`)
   - Show detailed surfaces and layers
   - Each surface shows its layers
   - Each layer shows product name, units, boxes, capacity
   - Status badges for open/full

3. **Products added with old data** (`!hasSurfaces && hasItems`)
   - Fallback to simple product list
   - Show product ID and quantity
   - Calculate boxes from units

## Visual Hierarchy

```
Group Order Status
├── Header (code, status badge)
├── Progress Bar
├── Details (participants, status)
├── Manufacturer (if set)
└── Content (one of):
    ├── MOQ Card (no products)
    ├── Surfaces Card (new data)
    │   ├── MOQ Info
    │   └── Surfaces
    │       └── Layers
    │           ├── Product Name
    │           ├── Units & Boxes
    │           └── Capacity
    └── Products List (fallback)
```

## Color Coding

- **Surface Status**:
  - `open` - Blue (#7dd3fc)
  - `full` - Green (#4ade80)

- **Layer Status**:
  - `open` - Yellow (#fcd34d)
  - `full` - Green (#4ade80)

## Example Output

### Empty Group Order
```
Group Order: ABC123
[Progress Bar: 0%]
0 participants | OPEN

MOQ Configuration
MOQ Surfaces: 1 pallet
Add products to start filling the group order
```

### Active Group Order
```
Group Order: ABC123
[Progress Bar: 45%]
3 participants | OPEN
Manufacturer: Acme Foods

Surfaces & Layers (Max 4 layers per surface)
MOQ: 1 surface (pallet)

┌─ Surface 1 ──────────────── open ─┐
│ ┌─ Layer 1 ──────────── full ─┐  │
│ │ Product: Tomato Paste        │  │
│ │ 12 units (1 box)             │  │
│ │ Capacity: 12 boxes           │  │
│ └──────────────────────────────┘  │
│                                    │
│ ┌─ Layer 2 ──────────── open ─┐  │
│ │ Product: Olive Oil           │  │
│ │ 17 units (2 boxes)           │  │
│ │ Capacity: 10 boxes           │  │
│ └──────────────────────────────┘  │
└────────────────────────────────────┘
```

## Benefits

1. **Transparency**: Users see exactly how products are allocated
2. **Visual Clarity**: Clear hierarchy of surfaces → layers → products
3. **Status Tracking**: Color-coded status for surfaces and layers
4. **MOQ Visibility**: Always shows MOQ requirement
5. **Backward Compatible**: Falls back to old format if new data unavailable

## Testing

### Test Cases

1. **Empty group order**
   - Should show MOQ card
   - Should display configured MOQ surfaces

2. **One product added**
   - Should show 1 surface with 1 layer
   - Layer should show product name, units, boxes

3. **Multiple products**
   - Should show layers for each product
   - Should respect surface max layers

4. **Full layer**
   - Layer status should be "full" (green)
   - Should show filled = capacity

5. **Multiple surfaces**
   - Should show Surface 1, Surface 2, etc.
   - Each with its own layers

## Files Modified

- `packages/db/src/index.ts` - Enhanced getGroupOrderStatus
- `packages/shared/src/index.ts` - Updated GroupOrderSnapshot type
- `services/orchestrator/src/ai/chatLoop.ts` - Pass new fields
- `apps/web/app/components/GroupOrderStatus.tsx` - Complete redesign
- `apps/web/app/components/ProductCard.tsx` - Fixed displayValue type
- `apps/web/app/globals.css` - Added new styles

---

**Date**: March 4, 2026
**Status**: Complete and tested
**Build**: All packages build successfully
