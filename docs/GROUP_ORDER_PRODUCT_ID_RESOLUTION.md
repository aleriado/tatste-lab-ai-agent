# Group Order Product ID Resolution Issue

## The Problem

User reported:
```
User: "add 10 פסטו ירוק סיציליאני to that group order"
Bot: "I couldn't add... because the product 'שמן אבוקדו' is missing required logistics data"
```

The bot tried to add "פסטו ירוק סיציליאני" (Sicilian Green Pesto) but the error mentioned "שמן אבוקדו" (Avocado Oil) - a completely different product!

## Root Cause

When a user types a product name manually (without clicking a product card), the message doesn't include a `[productId:...]` tag. The AI must:

1. Search for the product by name
2. Pick the correct product from search results
3. Use that product's ID in the tool call

**The AI was picking the WRONG product from search results.**

## Why This Happens

### Scenario 1: AI Doesn't Search First
```
User: "add פסטו to group"
AI: Guesses productId without searching
AI: Calls group_add_item(productId: "wrong_id")
Result: Wrong product added
```

### Scenario 2: AI Searches But Picks Wrong Result
```
User: "add פסטו to group"
AI: Calls product_search("פסטו")
Results: [
  { id: "123", name: "פסטו ירוק סיציליאני" },
  { id: "456", name: "שמן אבוקדו" },  // Wrong!
  { id: "789", name: "פסטו אדום" }
]
AI: Picks id "456" (wrong!)
AI: Calls group_add_item(productId: "456")
Result: Tries to add Avocado Oil instead of Pesto
```

### Scenario 3: AI Confuses Products in Context
```
Previous context: User was looking at Avocado Oil
User: "add פסטו to group"
AI: Thinks user means the previous product
AI: Calls group_add_item with Avocado Oil ID
Result: Wrong product
```

## The Fix

### 1. Updated System Prompt Rule 5

**Before**:
```
5. When the user wants to add something to cart, use cart_add_item with the EXACT 
product ID string. The user message may contain a tag like [productId:462] — extract 
it and use it directly as the productId.
```

**After**:
```
5. When the user wants to add something to cart or group order, use the EXACT product 
ID. The user message may contain a tag like [productId:462] — extract it and use it 
directly. If no ID tag is given and the name is ambiguous, you MUST call product_search 
first to find the correct product, then use that product's ID. If multiple products 
match, ask the user to clarify which one they mean.
```

### 2. Added New Rule 10.5 for Group Orders

```
10.5 CRITICAL - PRODUCT ID RESOLUTION FOR GROUP ORDERS: When user says "add [product 
name] to group order" WITHOUT a [productId:...] tag, you MUST call product_search first 
to find the exact product, then use that product's ID in group_add_item. NEVER guess 
the product ID. If search returns multiple matches, ask user to clarify. 

Example flow: 
User says "add פסטו to group" 
→ Call product_search("פסטו") 
→ Get results 
→ Use the correct product's ID 
→ Call group_add_item with that ID.
```

## Correct AI Behavior

### When User Clicks Product Card
```
User clicks "Add to cart" on Pesto card
Frontend sends: "Add פסטו ירוק סיציליאני to cart [productId:123]"
AI extracts: productId = "123"
AI calls: cart_add_item(productId: "123")
✅ Correct product added
```

### When User Types Product Name
```
User types: "add פסטו to group"
AI: No [productId:...] tag found
AI: Calls product_search("פסטו")
AI: Gets results with IDs
AI: Picks the best match (e.g., "פסטו ירוק סיציליאני", id: "123")
AI: Calls group_add_item(productId: "123", ...)
✅ Correct product added
```

### When Multiple Matches Found
```
User types: "add oil to group"
AI: Calls product_search("oil")
AI: Gets multiple results:
  - Olive Oil (id: "111")
  - Avocado Oil (id: "222")
  - Sunflower Oil (id: "333")
AI: Asks user: "I found several oils - Olive Oil, Avocado Oil, and Sunflower Oil. 
    Which one would you like to add?"
User: "avocado oil"
AI: Calls group_add_item(productId: "222", ...)
✅ Correct product added after clarification
```

## Testing

### Test Case 1: Exact Product Name
```
User: "add 10 פסטו ירוק סיציליאני to group ABC123"
Expected:
1. AI calls product_search("פסטו ירוק סיציליאני")
2. AI finds exact match with id "123"
3. AI calls group_add_item(code: "ABC123", productId: "123", quantity: 10)
4. Success: Pesto added
```

### Test Case 2: Partial Product Name
```
User: "add פסטו to group ABC123"
Expected:
1. AI calls product_search("פסטו")
2. AI finds "פסטו ירוק סיציליאני" (id: "123")
3. AI calls group_add_item(code: "ABC123", productId: "123", quantity: 1)
4. Success: Pesto added
```

### Test Case 3: Ambiguous Name
```
User: "add oil to group ABC123"
Expected:
1. AI calls product_search("oil")
2. AI finds multiple matches
3. AI asks: "I found Olive Oil, Avocado Oil, and Sunflower Oil. Which one?"
4. User clarifies
5. AI calls group_add_item with correct ID
```

### Test Case 4: With ProductId Tag
```
User clicks card, frontend sends: "Add Pesto to group ABC123 [productId:123]"
Expected:
1. AI extracts productId: "123"
2. AI calls group_add_item(code: "ABC123", productId: "123", quantity: 1)
3. No search needed
4. Success: Pesto added
```

## Prevention

To prevent this issue in the future:

1. **Always search first** when no `[productId:...]` tag is present
2. **Verify product name** matches user's request before calling add tool
3. **Ask for clarification** when multiple products match
4. **Log the product name** in error messages to help debug mismatches

## Related Issues

This same issue could affect:
- `cart_add_item` - Same fix applied
- `product_detail` - Should also search first
- `suggest_complements` - Needs correct product ID

## Files Modified

- `services/orchestrator/src/ai/systemPrompt.ts` - Updated rules 5 and 10.5

---

**Date**: March 4, 2026
**Status**: Fixed
**Impact**: High - Prevents wrong products from being added to orders
