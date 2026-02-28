import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getOpenAI, getModel } from './openaiClient';
import { buildSystemPrompt, type SystemPromptContext } from './systemPrompt';
import { conciergeTools } from './tools';
import { executeTool, type ToolContext } from './toolExecutor';
import type { WooProduct } from '../adapters/woocommerce';
import type { CartSummary } from '@taste-labs/db';
import type { ProductCard, CartSnapshot, GroupOrderSnapshot, CheckoutLink } from '@taste-labs/shared';
import { logInfo, logError } from '../logger';

const MAX_TOOL_ROUNDS = 6;

export interface ChatLoopInput {
  userMessage: string;
  conversationHistory: { role: 'user' | 'assistant'; content: string }[];
  systemPromptContext: SystemPromptContext;
  toolContext: ToolContext;
}

export interface ChatLoopResult {
  reply: string;
  cards?: ProductCard[];
  cart?: CartSnapshot;
  suggestions?: string[];
  link?: CheckoutLink;
  groupOrder?: GroupOrderSnapshot;
}

function wooToCard(p: WooProduct): ProductCard {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    imageUrl: p.images?.[0]?.src,
    shortDescription: p.shortDescription ?? p.description?.slice(0, 120),
    description: p.description,
    categories: p.categories?.map((c) => c.name),
    type: p.type as 'simple' | 'variable' | undefined,
    inStock: p.inStock
  };
}

export async function runChatLoop(input: ChatLoopInput): Promise<ChatLoopResult> {
  const { userMessage, conversationHistory, systemPromptContext, toolContext } = input;
  const openai = getOpenAI();
  const model = getModel();

  const systemPrompt = buildSystemPrompt(systemPromptContext);

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    })),
    { role: 'user', content: userMessage }
  ];

  // Collect structured data from tool calls
  let collectedCards: ProductCard[] = [];
  let collectedCart: CartSnapshot | undefined;
  let collectedLink: CheckoutLink | undefined;
  let collectedGroupOrder: GroupOrderSnapshot | undefined;
  // Prevent duplicate cart_add_item calls for the same product within one request
  const addedProductIds = new Set<string>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    logInfo(`Chat loop round ${round + 1}`, { traceId: toolContext.traceId, model });

    const response = await openai.chat.completions.create({
      model,
      messages,
      tools: conciergeTools,
      tool_choice: 'auto',
      max_tokens: 500
    });

    const choice = response.choices[0];
    if (!choice) {
      logError('No choice in OpenAI response', { traceId: toolContext.traceId });
      return { reply: 'I had trouble processing that. Could you try again?' };
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage as ChatCompletionMessageParam);

    // If no tool calls, we have the final reply
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const reply = assistantMessage.content ?? '';

      // Generate suggestions based on context
      const suggestions = generateSuggestions(collectedCards, collectedCart);

      return {
        reply,
        cards: collectedCards.length > 0 ? collectedCards : undefined,
        cart: collectedCart,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        link: collectedLink,
        groupOrder: collectedGroupOrder
      };
    }

    // Execute tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.type !== 'function') continue;
      const fnName = (toolCall as any).function.name;
      let fnArgs: Record<string, unknown> = {};
      try {
        fnArgs = JSON.parse((toolCall as any).function.arguments || '{}');
      } catch {
        fnArgs = {};
      }

      try {
        // Dedup: skip duplicate cart_add_item for same product in one request
        if (fnName === 'cart_add_item') {
          const pid = String(fnArgs.productId ?? '');
          if (addedProductIds.has(pid)) {
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ message: `Product already added to cart in this request` })
            });
            continue;
          }
          addedProductIds.add(pid);
        }

        const result = await executeTool(fnName, fnArgs, toolContext);

        // Collect structured data for frontend
        if (result.products && result.products.length > 0) {
          // Replace cards on each new product search, append for complements
          if (fnName === 'product_search') {
            collectedCards = result.products.map(wooToCard);
          } else {
            collectedCards = [...collectedCards, ...result.products.map(wooToCard)];
          }
        }

        // Collect cart snapshot
        const data = result.data as any;
        if (data?.cart || (fnName === 'cart_view' && data?.items)) {
          collectedCart = data.cart ?? data;
        }

        // Collect checkout link
        if (fnName === 'checkout_begin' && data?.paymentUrl) {
          collectedLink = {
            url: data.paymentUrl,
            label: 'Complete Payment',
            amountDueNow: data.amountDueNow?.toFixed(2),
            amountDueLater: data.amountDueLater?.toFixed(2)
          };
        }

        // Collect group order status
        if (data?.code && data?.moqTarget !== undefined) {
          collectedGroupOrder = {
            code: data.code,
            status: data.status,
            moqCurrent: data.moqCurrent,
            moqTarget: data.moqTarget,
            manufacturerId: data.manufacturerId ?? undefined,
            participantCount: data.participantCount,
            expiresAt: data.expiresAt ?? undefined,
            progress: data.progress ?? undefined
          };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result.data)
        });
      } catch (err) {
        logError(`Tool ${fnName} failed`, { traceId: toolContext.traceId, err });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
        });
      }
    }
  }

  // If we exhausted rounds, return whatever we have
  logError('Chat loop exhausted max rounds', { traceId: toolContext.traceId });
  return { reply: 'I ran into a complex situation. Could you simplify your request?' };
}

function generateSuggestions(cards: ProductCard[], cart?: CartSnapshot): string[] {
  const suggestions: string[] = [];

  for (const card of cards) {
    suggestions.push(`Add ${card.name} to cart [productId:${card.id}]`);
  }

  if (cart && cart.items.length > 0) {
    suggestions.push('View cart');
    suggestions.push('Checkout');
  } else if (cards.length === 0) {
    suggestions.push('What do you recommend?');
  }

  return suggestions;
}
