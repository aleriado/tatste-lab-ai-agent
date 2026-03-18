import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const conciergeTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'product_search',
      description: 'Search the Taste Labs product catalog. First matches by product name (and ranks by color/origin/taste in description if given). If no exact match, may return related products with matchType "related" and a "reason". Use when user asks for recommendations, a product type, or to browse. When the user asks for "products under X ILS" or "below X" or "cheaper than X", pass maxPrice: X so only products at or below that price are returned.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g. "שמן", "pasta", "oil"). Use empty string "" to list all products.' },
          limit: { type: 'number', description: 'Max results to return. Use 100-200 for recommendations/browse. Default 200.' },
          maxPrice: { type: 'number', description: 'Optional. Only return products with price (ILS) at or below this value. Use when user says "under X ILS", "below X", "cheaper than X".' },
          minPrice: { type: 'number', description: 'Optional. Only return products with price (ILS) at or above this value.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'product_detail',
      description: 'Get full details for a specific product (full description, images, categories). Use when user asks "tell me more about..." or wants details.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'The product ID to look up' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'product_variations',
      description: 'Get available variations for a variable product (sizes, types, etc.). Use when product type is "variable" and user needs to choose.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'The product ID to get variations for' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'suggest_complements',
      description: 'Get complementary/related products from the Taste Labs catalog for cross-sell (returns at most 3). MUST be called after every cart_add_item. When the user asks for recommendations to add to their import order or group order, or "same manufacturer" products, pass sameManufacturerOnly: true and use the productId from that order. In your reply, show at most 2–3 recommendations.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'The product ID to find complements for (e.g. a product in the user\'s import/group order)' },
          sameManufacturerOnly: { type: 'boolean', description: 'When true, return only products from the same manufacturer. Use this when the user asks for recommendations for their import/group order or "same manufacturer" so suggested products can be added to the same order.' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cart_add_item',
      description: 'Add a product to the shopping cart with the chosen order type (regular or stock). Use the product ID from get_order_type_options. Pass orderType (regular or stock) and unitPrice from the get_order_type_options result for that type — this ensures correct price (retail for regular, wholesale for stock). Same product can appear as separate lines (e.g. 60 units Stock + 30 units Regular).',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID from the catalog (from get_order_type_options or product_search)' },
          quantity: { type: 'number', description: 'Quantity to add (e.g. 100). Default 1 if not specified.' },
          orderType: { type: 'string', enum: ['regular', 'stock'], description: 'Order type for this line: "regular" (retail) or "stock" (wholesale). Use the type the user chose. Required.' },
          unitPrice: { type: 'number', description: 'Price per unit for this order type (from get_order_type_options pricePerUnit for the chosen type). Required for correct cart total.' },
          variantId: { type: 'string', description: 'Variant ID if product has variations' }
        },
        required: ['productId', 'orderType', 'unitPrice']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cart_remove_item',
      description: 'Remove a product line from the cart. If the same product appears as both Regular and Stock, pass orderType to remove only that line; otherwise removes all lines for that product.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to remove' },
          orderType: { type: 'string', enum: ['regular', 'stock'], description: 'Optional. Remove only this order type line (e.g. "stock"). If omitted, removes all lines for this product.' },
          variantId: { type: 'string', description: 'Variant ID if applicable' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cart_update_quantity',
      description: 'Update the quantity of a cart line. If the product has both Regular and Stock lines, pass orderType to update the correct one.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to update' },
          quantity: { type: 'number', description: 'New quantity (0 removes the item)' },
          orderType: { type: 'string', enum: ['regular', 'stock'], description: 'Optional. Update only this order type line. If omitted, updates the Regular line.' },
          variantId: { type: 'string', description: 'Variant ID if applicable' }
        },
        required: ['productId', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cart_view',
      description: 'View the current shopping cart contents with totals. Use when user asks to see their cart.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cart_clear',
      description: 'Clear all items from the shopping cart. Use when user wants to start over.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'checkout_begin',
      description: 'Start the checkout process. Generates a payment link with 50/50 split payment. Always show cart summary and ask for confirmation before calling this.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_create',
      description: 'Create a new group order. Returns a shareable code for others to join. MOQ (minimum surfaces/pallets) is automatically set from system configuration. Group orders support one manufacturer only.',
      parameters: {
        type: 'object',
        properties: {
          deadlineHours: { type: 'number', description: 'Hours until the group order expires (optional, e.g., 48 for 2 days)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_join',
      description: 'Join an existing group order using its code.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code to join' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_leave',
      description: 'Leave a group order. Removes the user and their items.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code to leave' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_delete',
      description: 'Delete a group order by code. Only the original creator can delete it.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code to delete' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_status',
      description: 'Check the status of a group order (participants, MOQ progress, deadline).',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_discover',
      description: 'List active shared group orders that users can join. Use when user asks "any open group order?" or wants to browse public group orders.',
      parameters: {
        type: 'object',
        properties: {
          manufacturer: { type: 'string', description: 'Optional manufacturer name to filter compatible orders.' },
          limit: { type: 'number', description: 'Max group orders to return (default 10).' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_best_match',
      description: 'Find the best existing shared group orders for a product, prioritizing orders closest to MOQ (or already reached). Use to explain which order is best and why.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to find best matching group orders for.' },
          limit: { type: 'number', description: 'Max recommended orders to return (default 3).' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_add_item',
      description: 'Add a product to a group order. CRITICAL: Use the correct product ID. When the user names a product (e.g. "מעדן פירות יער עשיר 110%"), call product_search with that exact name first and use the returned product ID — do NOT use a different product ID (e.g. berry vs apricot have different IDs). If they just added a product and say "add more" or "add X units of that product", use the same productId from the previous group_add_item. Quantity is in UNITS, not boxes. If the user says "X boxes", convert: quantity = X × unitsPerBox (get unitsPerBox from get_order_type_options response). All products in a group order must be from the same manufacturer.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code' },
          productId: { type: 'string', description: 'Product ID from product_search for the named product. Must match the product the user asked for (e.g. מעדן פירות יער ≠ מעדן משמשים).' },
          quantity: { type: 'number', description: 'Quantity in UNITS (individual items), not boxes. Default is 1 unit. System rounds up to full boxes automatically.' },
          variantId: { type: 'string', description: 'Variant ID if applicable' }
        },
        required: ['code', 'productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_remove_item',
      description: 'Remove a product from a group order.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code' },
          productId: { type: 'string', description: 'Product ID to remove' }
        },
        required: ['code', 'productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'group_checkout',
      description: 'Initiate checkout for a MOQ_REACHED group order. Locks the order and generates a payment link for the current participant based on their share of the order. Only works when the group order status is MOQ_REACHED.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_order_type_options',
      description: 'Get available order types for a product. Returns which order types (Regular, Stock, Group, Import) are available, pricing, existing orders, and unitsPerBox. When the user then replies with a quantity (e.g. "70"), you MUST use this same productId for cart_add_item — do not use a different product ID or cart_add_item will fail with "not purchasable".',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'The product ID to get order type options for' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_order_create',
      description: 'Create a new import order for a single user (restaurant/supermarket). Import orders follow the same palette/surface/layer rules as group orders but are restricted to one participant. Returns a shareable code and palette capacity details.',
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'The customer ID creating the import order' },
          deadlineHours: { type: 'number', description: 'Hours until the import order expires (optional, e.g., 72 for 3 days)' }
        },
        required: ['customerId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_order_check',
      description: 'Check for existing open import orders for a customer and manufacturer. Use before creating a new import order to avoid duplicates — if an open import order exists for the same manufacturer, the user should add items to it instead.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to determine the manufacturer' },
          customerId: { type: 'string', description: 'The customer ID to check import orders for' }
        },
        required: ['productId', 'customerId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_add_item',
      description: 'Add a product to an import order. Quantity is in UNITS (individual items), NOT boxes. If the user says "X boxes", convert: quantity = X × unitsPerBox (get unitsPerBox from get_order_type_options response). The system uses the existing allocation engine to allocate units to surfaces and layers. Only the import order creator can add items. Returns palette fill progress after addition.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The import order code' },
          productId: { type: 'string', description: 'Product ID to add' },
          quantity: { type: 'number', description: 'Quantity in UNITS (individual items). System rounds up to full boxes automatically.' }
        },
        required: ['code', 'productId', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_order_list',
      description: "List the current customer's open import orders (with codes). Call this when the user asks for 'my import order status' or 'my import order' and does NOT provide a code — then use the returned code(s) to call import_order_status. Always show the code to the user (e.g. 'Your import order FKFQAG …') so they can refer to it.",
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Optional. Customer ID; if omitted, uses the current session customer.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_order_status',
      description: 'Get the status of an import order by code. When the user asks for "my import order status" without giving a code, call import_order_list first to get their order code(s), then call this with that code. Include the code in your reply (e.g. "Import order FKFQAG: …").',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The import order code (from import_order_list or from the user / previous message)' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_remove_item',
      description: 'Remove a product from an import order. Only the import order creator can remove items. Use the productId from the order status (items or layers).',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The import order code' },
          productId: { type: 'string', description: 'Product ID to remove (from import order status items)' }
        },
        required: ['code', 'productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'import_order_delete',
      description: 'Cancel/delete an import order. Only the creator can delete it. The order and all its items are removed. Use when the user wants to cancel or delete their import order.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The import order code to delete' }
        },
        required: ['code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'order_status',
      description: 'Get the status of any order (regular, group, or import) by order ID or code. Returns current status, items, and available actions. For group/import orders, includes palette fill progress, participant count, and days remaining.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order ID (for regular orders)' },
          code: { type: 'string', description: 'The order code (for group or import orders)' }
        }
      }
    }
  }
];
