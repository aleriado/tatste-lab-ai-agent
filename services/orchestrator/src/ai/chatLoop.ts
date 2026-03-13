import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getOpenAI, getModel } from './openaiClient';
import { buildSystemPrompt, type SystemPromptContext } from './systemPrompt';
import { conciergeTools } from './tools';
import { executeTool, type ToolContext } from './toolExecutor';
import { tagMessageWithLanguage, detectLanguage, isNumbersOnly } from './languageHandler';
import type { DetectedLanguage } from './languageHandler';
import { stripPricesForCatalogExtension } from './interventionGates';
import type { WooProduct } from '../adapters/woocommerce';
import type { CartSummary } from '@taste-labs/db';
import type { ProductCard, CartSnapshot, GroupOrderSnapshot, ImportOrderSnapshot, CheckoutLink } from '@taste-labs/shared';
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
  importOrder?: ImportOrderSnapshot;
  detectedLanguage?: 'he' | 'en';
}

function wooToCard(p: WooProduct): ProductCard {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    imageUrl: p.images?.[0]?.src,
    shortDescription: p.shortDescription ?? p.description?.slice(0, 120),
    description: p.description,
    detailedDescription: p.detailedDescription ?? p.description ?? p.shortDescription,
    categories: p.categories?.map((c) => c.name),
    subCategory: p.subCategory,
    type: p.type as 'simple' | 'variable' | undefined,
    inStock: p.inStock,
    inventory: p.inventory,
    manufacturer: p.manufacturer ?? (p.metadata?.manufacturer as string | undefined),
    brand: p.brand ?? (p.metadata?.brand as string | undefined),
    countryOfOrigin: p.countryOfOrigin ?? (p.metadata?.countryOfOrigin as string | undefined),
    sku: p.sku ?? (p.metadata?.sku as string | undefined),
    tags: p.tags ?? (p.metadata?.tags as string[] | undefined),
    weight: p.weight ?? (p.metadata?.weight as string | undefined),
    barcode: p.barcode ?? (p.metadata?.barcode as string | undefined),
    costPrice: p.costPrice ?? (p.metadata?.costPrice as string | undefined),
    importPricePerSurface: p.importPricePerSurface ?? (p.metadata?.importPricePerSurface as string | undefined),
    importPricePer2Boxes: p.importPricePer2Boxes ?? (p.metadata?.importPricePer2Boxes as string | undefined),
    wholesalePrice: p.wholesalePrice ?? (p.metadata?.wholesalePrice as string | undefined),
    retailPrice: p.retailPrice ?? (p.metadata?.retailPrice as string | undefined),
    salePrice: p.salePrice ?? (p.metadata?.salePrice as string | undefined),
    status: p.status ?? (p.metadata?.status as string | undefined),
    isDownloadable: p.isDownloadable,
    downloadLink: p.downloadLink,
    unitsPerBox: p.unitsPerBox ?? (p.metadata?.unitsPerBox as number | undefined),
    boxesPerLayer: p.boxesPerLayer ?? (p.metadata?.boxesPerLayer as number | undefined),
    layersPerSurface: p.layersPerSurface ?? (p.metadata?.layersPerSurface as number | undefined),
    boxesPerSurface: p.boxesPerSurface ?? (p.metadata?.boxesPerSurface as number | undefined)
  };
}

/** Get language from the last assistant (bot) message. */
function getLastAssistantLanguage(history: { role: string; content: string }[]): DetectedLanguage | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'assistant') continue;
    const content = (history[i].content ?? '').trim();
    if (content.length === 0) continue;
    return detectLanguage(content);
  }
  return null;
}

/** Get language from the last user message that is not numbers-only (e.g. "5" after "רגילה במחיר" → use Hebrew). */
function getLastUserLanguage(history: { role: string; content: string }[]): DetectedLanguage | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== 'user') continue;
    const content = history[i].content.replace(/^\[LANGUAGE:\s*[^\]]+\]\s*\n?/i, '').trim();
    if (content.length === 0 || isNumbersOnly(content)) continue;
    if (/^\[LANGUAGE:\s*he\]/i.test(history[i].content)) return 'he';
    if (/^\[LANGUAGE:\s*en\]/i.test(history[i].content)) return 'en';
    return detectLanguage(content);
  }
  return null;
}

export async function runChatLoop(input: ChatLoopInput): Promise<ChatLoopResult> {
  const { userMessage, conversationHistory, systemPromptContext, toolContext } = input;
  const openai = getOpenAI();
  const model = getModel();

  // M2: When input is numbers-only, use the last user message that had text (so "5" after "רגילה במחיר" → Hebrew).
  //     Fallback to last assistant, then default Hebrew.
  const lastLang = isNumbersOnly(userMessage)
    ? (getLastUserLanguage(conversationHistory) ?? getLastAssistantLanguage(conversationHistory) ?? 'he')
    : null;
  const detectedLang = lastLang ?? detectLanguage(userMessage);
  const taggedMessage = tagMessageWithLanguage(userMessage, lastLang);

  const systemPrompt = buildSystemPrompt({
    ...systemPromptContext,
    replyLanguage: detectedLang,
  });

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    })),
    { role: 'user', content: taggedMessage }
  ];

  // Collect structured data from tool calls
  let collectedCards: ProductCard[] = [];
  let collectedCart: CartSnapshot | undefined;
  let collectedLink: CheckoutLink | undefined;
  let collectedGroupOrder: GroupOrderSnapshot | undefined;
  let collectedImportOrder: ImportOrderSnapshot | undefined;
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

      // M2: AIS-04 — strip prices from CATALOG_EXTENSION products before sending to frontend
      const sanitizedCards = collectedCards.map(stripPricesForCatalogExtension);

      const suggestions = generateSuggestions(sanitizedCards, collectedCart);

      return {
        reply,
        cards: sanitizedCards.length > 0 ? sanitizedCards : undefined,
        cart: collectedCart,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        link: collectedLink,
        groupOrder: collectedGroupOrder,
        importOrder: collectedImportOrder,
        detectedLanguage: detectedLang,
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

        // Collect checkout link (regular or group order)
        if ((fnName === 'checkout_begin' || fnName === 'group_checkout') && data?.paymentUrl) {
          collectedLink = {
            url: data.paymentUrl,
            label: fnName === 'group_checkout' ? `Pay my share — ₪${data.yourTotal}` : 'Complete Payment',
            amountDueNow: data.amountDueNow?.toFixed(2),
            amountDueLater: data.amountDueLater?.toFixed(2)
          };
        }

        // Collect group order status (non-import group orders)
        if (data?.code && data?.moqTarget !== undefined && !data?.isImport) {
          collectedGroupOrder = {
            code: data.code,
            status: data.status,
            moqCurrent: data.moqCurrent,
            moqTarget: data.moqTarget,
            moqSurfaces: data.moqSurfaces ?? 1,
            surfaceMaxLayers: data.surfaceMaxLayers ?? undefined,
            manufacturer: data.manufacturer ?? undefined,
            participantCount: data.participantCount,
            expiresAt: data.expiresAt ?? undefined,
            progress: data.progress ?? undefined,
            surfaces: data.surfaces ?? undefined,
            participantCosts: data.participantCosts ?? undefined
          };
        }

        // M2: Collect import order snapshot (same shape as group order for unified status UI)
        if (data?.isImport === true && data?.code) {
          collectedImportOrder = {
            code: data.code,
            status: data.status,
            moqCurrent: data.moqCurrent ?? 0,
            moqTarget: data.moqTarget ?? data.moqSurfaces ?? 1,
            moqSurfaces: data.moqSurfaces ?? 1,
            surfaceMaxLayers: data.surfaceMaxLayers ?? undefined,
            manufacturer: data.manufacturer ?? undefined,
            participantCount: data.participantCount ?? 1,
            expiresAt: data.expiresAt != null
              ? (typeof data.expiresAt === 'string' ? data.expiresAt : (data.expiresAt as Date).toISOString())
              : undefined,
            progress: data.progress ?? undefined,
            surfaces: data.surfaces ?? undefined,
            participantCosts: data.participantCosts ?? undefined,
            isImport: true,
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
    // Do NOT embed productId tags — they become stale in conversation history
    // and cause the AI to use outdated IDs instead of calling product_search first
    suggestions.push(`Purchase ${card.name}`);
  }

  if (cart && cart.items.length > 0) {
    suggestions.push('View cart');
    suggestions.push('Checkout');
  } else if (cards.length === 0) {
    suggestions.push('What do you recommend?');
  }

  return suggestions;
}
