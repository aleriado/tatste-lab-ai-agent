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
          limit: { type: 'number', description: 'Max results to return (default 6)' }
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
      description: 'Create a new group order. Returns a shareable code for others to join.',
      parameters: {
        type: 'object',
        properties: {
          moqTarget: { type: 'number', description: 'Minimum order quantity target (total items needed)' },
          deadlineHours: { type: 'number', description: 'Hours until the group order expires (optional)' }
        },
        required: ['moqTarget']
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
      name: 'group_add_item',
      description: 'Add a product to a group order.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The group order code' },
          productId: { type: 'string', description: 'Product ID to add' },
          quantity: { type: 'number', description: 'Quantity to add (default 1)' },
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
  }
];
