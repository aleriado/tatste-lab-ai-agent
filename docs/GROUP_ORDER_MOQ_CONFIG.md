# Group Order MOQ Configuration

## TL;DR

**MOQ (Minimum Order Quantity) is automatically set from the environment variable `GROUP_ORDER_DEFAULT_MOQ_SURFACES`.**

Users do NOT set the MOQ when creating a group order.

## The Problem

The AI bot was asking users:
> "To create a group order, please tell me the minimum order quantity (MOQ) target you'd like to set for the group"

This is **WRONG**. MOQ is a system configuration, not a user input.

## The Correct Behavior

### ✅ CORRECT: MOQ from Environment

```bash
# .env
GROUP_ORDER_DEFAULT_MOQ_SURFACES=1
```

When a user creates a group order, the system automatically uses this value.

### User Flow

**User**: "I want to create a group order"
**AI**: "I'll create a group order for you! Would you like to set a deadline (e.g., 48 hours for 2 days)?"
**User**: "Yes, 48 hours"
**AI**: *Creates group order with MOQ=1 surface (from env) and 48-hour deadline*

### What Users CAN Set

- ✅ **Deadline** (optional): How many hours until the group order expires
  - Example: 48 hours (2 days), 72 hours (3 days)
  - If not set, group order has no expiration

### What Users CANNOT Set

- ❌ **MOQ**: This is configured by the system administrator
- ❌ **Manufacturer**: This is automatically set when the first product is added
- ❌ **Surface max layers**: This is calculated automatically based on products

## Implementation

### Function Signature (OLD - DEPRECATED)

```typescript
// ❌ OLD - Required moqTarget parameter
createGroupOrder(customerId: string, moqTarget: number, deadlineHours?: number)
```

### Function Signature (NEW - CORRECT)

```typescript
// ✅ NEW - MOQ from environment
createGroupOrder(customerId: string, deadlineHours?: number)
```

### Tool Definition

```typescript
{
  name: 'group_create',
  description: 'Create a new group order. MOQ is automatically set from system configuration.',
  parameters: {
    type: 'object',
    properties: {
      deadlineHours: { 
        type: 'number', 
        description: 'Hours until the group order expires (optional)' 
      }
    }
    // NO moqTarget parameter!
  }
}
```

### System Prompt

```
10.2 MOQ (Minimum Order Quantity) is automatically set by the system in surfaces/pallets 
(משטח), NOT by the user. When creating a group order, do NOT ask the user for MOQ - 
it's configured automatically. You can optionally ask if they want to set a deadline.
```

## Environment Variables

### GROUP_ORDER_DEFAULT_MOQ_SURFACES

- **Type**: Integer
- **Default**: 1
- **Unit**: Surfaces/Pallets (משטח)
- **Description**: Minimum number of surfaces (pallets) required before a group order can be checked out

### Example Configuration

```bash
# .env

# Require 1 full pallet before checkout (default)
GROUP_ORDER_DEFAULT_MOQ_SURFACES=1

# Require 2 full pallets before checkout
GROUP_ORDER_DEFAULT_MOQ_SURFACES=2

# Allow extra surfaces beyond MOQ
GROUP_ORDER_ALLOW_EXTRA_SURFACES=true

# Maximum surfaces allowed (when extra surfaces enabled)
GROUP_ORDER_MAX_SURFACES=10
```

## Why MOQ is System-Configured

1. **Business Rules**: MOQ is a business constraint, not a user preference
2. **Logistics**: Based on shipping/warehouse capabilities
3. **Consistency**: All group orders follow the same rules
4. **Simplicity**: Users don't need to understand pallet logistics

## What MOQ Means

- **MOQ = 1 surface**: Group order needs 1 full pallet before checkout
- **MOQ = 2 surfaces**: Group order needs 2 full pallets before checkout
- **Surface = Pallet (משטח)**: Physical shipping unit with multiple layers

### Example

```
GROUP_ORDER_DEFAULT_MOQ_SURFACES=1

User creates group order → MOQ automatically set to 1 surface
Users add products → System tracks progress toward 1 full pallet
When 1 pallet is full → Group order reaches MOQ, ready for checkout
```

## Testing

### Test Case 1: Create Without Deadline

```
User: "Create a group order"
AI calls: group_create() // No parameters
Result: Group order with MOQ=1 (from env), no expiration
```

### Test Case 2: Create With Deadline

```
User: "Create a group order that expires in 2 days"
AI calls: group_create(deadlineHours: 48)
Result: Group order with MOQ=1 (from env), expires in 48 hours
```

### Test Case 3: AI Should NOT Ask for MOQ

```
User: "I want to create a group order"
AI: "I'll create a group order for you! Would you like to set a deadline?"
✅ CORRECT - Does not ask for MOQ

AI: "What MOQ target would you like to set?"
❌ WRONG - Should not ask for MOQ
```

## Migration Notes

### Backward Compatibility

The old `moqTarget` field is still in the database for backward compatibility:

```typescript
// Database schema
model GroupOrder {
  moqSurfaces Int @default(1)  // NEW: Used by new algorithm
  moqTarget   Int @default(1)  // DEPRECATED: Kept for compatibility
  moqCurrent  Int @default(0)  // DEPRECATED: Kept for compatibility
}
```

When creating a new group order:
- `moqSurfaces` is set from `GROUP_ORDER_DEFAULT_MOQ_SURFACES`
- `moqTarget` is set to 1 (ignored by new algorithm)
- `moqCurrent` is set to 0 (ignored by new algorithm)

## Summary

- ✅ MOQ is from environment variable `GROUP_ORDER_DEFAULT_MOQ_SURFACES`
- ✅ Users can optionally set deadline (hours)
- ✅ AI should NOT ask users for MOQ
- ❌ Users do NOT set MOQ
- ❌ `moqTarget` parameter is deprecated

---

**Last Updated**: March 4, 2026
**Related Docs**:
- `GROUP_ORDER_IMPLEMENTATION_COMPLETE.md`
- `GROUP_ORDER_QUANTITIES.md`
- `.env.example`
