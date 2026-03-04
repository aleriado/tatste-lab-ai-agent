# Group Order Quantities - Units vs Boxes

## TL;DR

**Quantities are ALWAYS in UNITS (individual items), NOT boxes.**

When a user says "add 1 tomato paste," they mean 1 unit (1 jar), not 1 box.

## The Problem

The AI agent was confused and told users:
> "When you say 'add 1,' it means adding one box or one unit depending on the product packaging."

This is **WRONG**. The quantity is always in units.

## The Correct Behavior

### User Input → System Processing

1. **User says**: "Add 1 מחית עגבניות" (1 tomato paste)
2. **AI calls**: `group_add_item(code, productId, quantity: 1)`
3. **System receives**: `quantityUnits: 1`
4. **System converts**: `ceil(1 / 12) = 1 box` (if 12 units per box)
5. **System allocates**: 1 box = 12 units

### Examples

| User Request | Quantity Passed | Units Per Box | Boxes Allocated | Actual Units Added |
|--------------|-----------------|---------------|-----------------|-------------------|
| "Add 1 tomato paste" | 1 | 12 | 1 box | 12 units |
| "Add 5 olive oils" | 5 | 6 | 1 box | 6 units |
| "Add 15 units" | 15 | 12 | 2 boxes | 24 units |
| "Add 24 units" | 24 | 12 | 2 boxes | 24 units |
| "Add 25 units" | 25 | 12 | 3 boxes | 36 units |

## Why Units, Not Boxes?

1. **User Mental Model**: Users think in individual items (bottles, jars, cans)
2. **Natural Language**: "Add 1 tomato paste" means 1 jar, not 1 box of 12 jars
3. **Wholesale Rules**: System enforces full-box ordering automatically
4. **Transparency**: User sees "1 unit → 1 box (12 units)" in response

## How the AI Should Respond

### ✅ CORRECT Responses

**User**: "Add 1 tomato paste to the group"
**AI**: "I'll add 1 unit of tomato paste to the group order. Since wholesale requires full boxes, this will allocate 1 box (12 units)."

**User**: "Add 15 olive oils"
**AI**: "I'll add 15 units of olive oil. Since each box contains 6 units, this will allocate 3 boxes (18 units total)."

### ❌ WRONG Responses

**User**: "Add 1 tomato paste to the group"
**AI**: "When you say 'add 1,' it means adding one box or one unit depending on the product packaging."
→ This is confusing and incorrect!

**User**: "Add 1 tomato paste"
**AI**: "I'll add 1 box (12 units) to the group."
→ User said 1 unit, not 1 box!

## Code Implementation

### Tool Definition (tools.ts)
```typescript
{
  name: 'group_add_item',
  description: 'Add a product to a group order. IMPORTANT: quantity is in UNITS (individual items), NOT boxes.',
  parameters: {
    quantity: { 
      type: 'number', 
      description: 'Quantity in UNITS (individual items), not boxes. Default is 1 unit.' 
    }
  }
}
```

### System Prompt (systemPrompt.ts)
```
10.3 CRITICAL - GROUP ORDER QUANTITIES: When adding to group orders, quantities are 
ALWAYS in UNITS (individual items), NOT boxes. The system automatically converts to 
full boxes. Example: If user says "add 1 tomato paste" they mean 1 unit (1 jar/bottle), 
not 1 box.
```

### Service Layer (service.ts)
```typescript
export interface AddItemToGroupOrderInput {
  quantityUnits: number; // <-- Named "quantityUnits" to be explicit
  // ...
}
```

### Allocation Algorithm (allocation.ts)
```typescript
// Convert units to boxes (wholesale ordering - must order full boxes)
const quantityBoxes = Math.ceil(input.quantityUnits / input.product.unitsPerBox);
const actualUnits = quantityBoxes * input.product.unitsPerBox;
```

## Testing

### Test Case 1: Single Unit
```
User: "Add 1 tomato paste"
Expected: quantity=1, allocates 1 box (12 units)
```

### Test Case 2: Multiple Units (Exact)
```
User: "Add 24 units"
Expected: quantity=24, allocates 2 boxes (24 units)
```

### Test Case 3: Multiple Units (Rounds Up)
```
User: "Add 15 units"
Expected: quantity=15, allocates 2 boxes (24 units)
```

### Test Case 4: Natural Language
```
User: "Add 3 olive oils"
Expected: quantity=3, allocates 1 box (6 units if 6 per box)
```

## Summary

- ✅ Quantity = UNITS (individual items)
- ✅ System converts to boxes automatically
- ✅ Rounds up to nearest full box
- ✅ User sees transparent conversion
- ❌ Quantity ≠ boxes
- ❌ Don't confuse users with "depends on packaging"

---

**Last Updated**: March 4, 2026
**Related Docs**: 
- `GROUP_ORDER_IMPLEMENTATION_COMPLETE.md`
- `GROUP_ORDER_QUICK_START.md`
