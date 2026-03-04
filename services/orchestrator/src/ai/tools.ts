import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const conciergeTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'product_search',
      description: 'Search the Taste Labs product catalog. Use when user asks for recommendations, mentions a product type, or wants to browse. Pass an empty string "" as query to get all available products.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g. "שמן", "pasta", "oil"). Use empty string "" to list all products.' },
          limit: { type: 'number', description: 'Max results to return. Use 100-200 for recommendations/browse. Default 200. Never use less than 50 for catalog browse.' }
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
      description: 'Get complementary/related products from the Taste Labs catalog for cross-sell. MUST be called after every cart_add_item. Returns other products that pair well with the given product. Use the product details (names, descriptions, categories) to explain to the user why they complement each other.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'The product ID to find complements for' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cart_add_item',
      description: 'Add a product to the shopping cart. If the item already exists, quantity is incremented. IMPORTANT: Always use quantity 1 unless the user explicitly asks for more.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to add' },
          quantity: { type: 'number', description: 'Quantity to add. Default is 1. Only set higher if user explicitly requests multiple.' },
          variantId: { type: 'string', description: 'Variant ID if product has variations' }
        },
        required: ['productId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'cart_remove_item',
      description: 'Remove a product from the shopping cart entirely.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to remove' },
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
      description: 'Update the quantity of an item already in the cart.',
      parameters: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to update' },
          quantity: { type: 'number', description: 'New quantity (0 removes the item)' },
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
      description: 'Add a product to a group order. IMPORTANT: quantity is in UNITS (individual items), NOT boxes. The system automatically rounds up to full boxes for wholesale ordering. Example: quantity=1 means 1 unit (1 jar/bottle), quantity=15 with 12 units/box means 2 boxes (24 units). All products in a group order must be from the same manufacturer.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code' },
          productId: { type: 'string', description: 'Product ID to add' },
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
  }
];
