import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { getOpenAI, getModel } from './openaiClient';
import { buildSystemPrompt, type SystemPromptContext } from './systemPrompt';
import { conciergeTools } from './tools';
import { executeTool, type ToolContext } from './toolExecutor';
import { tagMessageWithLanguage, detectLanguage, isNumbersOnly } from './languageHandler';
import type { DetectedLanguage } from './languageHandler';
import { stripPricesForCatalogExtension } from './interventionGates';
import type { WooProduct } from '../adapters/woocommerce';
import { getGroupOrderStatus } from '@taste-labs/db';
import type { ProductCard, CartSnapshot, GroupOrderSnapshot, ImportOrderSnapshot, CheckoutLink, QuantityPrompt } from '@taste-labs/shared';
import { logInfo, logError } from '../logger';

const MAX_TOOL_ROUNDS = 6;

/** Remove em dashes and en dashes from model output so they never reach the user. */
function sanitizeReplyForDisplay(text: string): string {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\u2014/g, ', ')   // em dash —
    .replace(/\u2013/g, ', ');  // en dash –
}

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
  /** When user asks for all group/import orders status, these arrays are populated. */
  groupOrders?: GroupOrderSnapshot[];
  importOrders?: ImportOrderSnapshot[];
  detectedLanguage?: 'he' | 'en';
  /** When the bot is asking for a stock order quantity, carries MOQ constraints for the visual picker. */
  quantityPrompt?: QuantityPrompt;
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

/**
 * Scans the message history for the most recent get_order_type_options result that
 * contains a stock type with moqBoxes, and checks that the product was not already
 * added to cart as a stock order. Returns the data needed to render the quantity picker.
 */
function extractStockQuantityPrompt(messages: ChatCompletionMessageParam[]): QuantityPrompt | undefined {
  let latestOrderTypeCallId: string | null = null;
  let latestOrderTypeResult: Record<string, unknown> | null = null;
  let stockCartedProductId: string | null = null;

  for (const m of messages) {
    if (m.role === 'assistant' && (m as any).tool_calls) {
      for (const tc of (m as any).tool_calls) {
        if (tc.function?.name === 'get_order_type_options') {
          latestOrderTypeCallId = tc.id;
          latestOrderTypeResult = null; // reset until we find its result
        }
        if (tc.function?.name === 'cart_add_item') {
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            if (args.orderType === 'stock') stockCartedProductId = String(args.productId ?? '');
          } catch { /* ignore */ }
        }
      }
    }
    if (m.role === 'tool' && latestOrderTypeCallId && (m as any).tool_call_id === latestOrderTypeCallId) {
      try {
        latestOrderTypeResult = JSON.parse(m.content as string);
      } catch { /* ignore */ }
    }
  }

  if (!latestOrderTypeResult) return undefined;

  const types = latestOrderTypeResult.types as Array<Record<string, unknown>> | undefined;
  const stockType = types?.find((t) => t.type === 'stock' && t.available && t.moqBoxes);
  if (!stockType) return undefined;

  const productId = String(latestOrderTypeResult.productId ?? '');
  if (!productId || stockCartedProductId === productId) return undefined;

  const moqBoxes = Number(stockType.moqBoxes);
  return {
    orderType: 'stock',
    productId,
    productName: String(latestOrderTypeResult.productName ?? ''),
    min: moqBoxes,
    default: moqBoxes,
    pricePerUnit: stockType.pricePerUnit != null ? String(stockType.pricePerUnit) : undefined,
    unitsPerBox: latestOrderTypeResult.unitsPerBox != null ? Number(latestOrderTypeResult.unitsPerBox) : undefined,
  };
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
  let collectedGroupOrders: GroupOrderSnapshot[] = [];
  let collectedImportOrders: ImportOrderSnapshot[] = [];
  // Prevent duplicate cart_add_item calls for the same product within one request
  const addedProductIds = new Set<string>();

  function toGroupSnapshot(go: {
    code: string; status: string; moqCurrent: number; moqTarget: number; participantCount: number;
    moqSurfaces?: number | null; surfaceMaxLayers?: number | null; manufacturer?: string | null;
    expiresAt?: Date | string | null; progress?: GroupOrderSnapshot['progress']; surfaces?: GroupOrderSnapshot['surfaces'];
    participantCosts?: GroupOrderSnapshot['participantCosts']; surfaceStatusSummary?: GroupOrderSnapshot['surfaceStatusSummary'];
  }): GroupOrderSnapshot {
    const expiresAt = go.expiresAt != null ? (typeof go.expiresAt === 'string' ? go.expiresAt : (go.expiresAt as Date).toISOString()) : undefined;
    return {
      code: go.code,
      status: go.status,
      moqCurrent: go.moqCurrent,
      moqTarget: go.moqTarget,
      moqSurfaces: go.moqSurfaces ?? 1,
      surfaceMaxLayers: go.surfaceMaxLayers ?? undefined,
      manufacturer: go.manufacturer ?? undefined,
      participantCount: go.participantCount,
      expiresAt,
      progress: go.progress,
      surfaces: go.surfaces,
      participantCosts: go.participantCosts,
      surfaceStatusSummary: go.surfaceStatusSummary,
    };
  }
  function toImportSnapshot(go: {
    code: string; status: string; moqTarget: number;
    moqCurrent?: number; participantCount?: number; moqSurfaces?: number | null; surfaceMaxLayers?: number | null;
    manufacturer?: string | null; expiresAt?: Date | string | null; progress?: GroupOrderSnapshot['progress'];
    surfaces?: GroupOrderSnapshot['surfaces']; participantCosts?: GroupOrderSnapshot['participantCosts'];
    surfaceStatusSummary?: GroupOrderSnapshot['surfaceStatusSummary'];
  }): ImportOrderSnapshot {
    return {
      ...toGroupSnapshot({
        ...go,
        moqCurrent: (go.moqCurrent as number | undefined) ?? 0,
        participantCount: (go.participantCount as number | undefined) ?? 1,
      }),
      isImport: true,
    };
  }
  function upsertByCode<T extends { code: string }>(arr: T[], item: T): T[] {
    const i = arr.findIndex((x) => x.code === item.code);
    if (i >= 0) {
      const out = [...arr];
      out[i] = item;
      return out;
    }
    return [...arr, item];
  }

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
      return { reply: sanitizeReplyForDisplay('I had trouble processing that. Could you try again?') };
    }

    const assistantMessage = choice.message;
    messages.push(assistantMessage as ChatCompletionMessageParam);

    // If no tool calls, we have the final reply
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const reply = sanitizeReplyForDisplay(assistantMessage.content ?? '');

      // M2: AIS-04 — strip prices from CATALOG_EXTENSION products before sending to frontend
      const sanitizedCards = collectedCards.map(stripPricesForCatalogExtension);

      const suggestions = generateSuggestions(sanitizedCards, collectedCart);

      return {
        reply,
        cards: sanitizedCards.length > 0 ? sanitizedCards : undefined,
        cart: collectedCart,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        link: collectedLink,
        groupOrder: collectedGroupOrders[0],
        importOrder: collectedImportOrders[0],
        groupOrders: collectedGroupOrders.length > 0 ? collectedGroupOrders : undefined,
        importOrders: collectedImportOrders.length > 0 ? collectedImportOrders : undefined,
        detectedLanguage: detectedLang,
        quantityPrompt: extractStockQuantityPrompt(messages),
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

        // Collect single group order status (group_status returns one)
        if (fnName === 'group_status' && data?.code && data?.moqTarget !== undefined && !data?.isImport) {
          collectedGroupOrders = upsertByCode(collectedGroupOrders, toGroupSnapshot(data));
        }

        // Collect single import order status (import_order_status returns one)
        if (fnName === 'import_order_status' && data?.isImport === true && data?.code) {
          collectedImportOrders = upsertByCode(collectedImportOrders, toImportSnapshot(data));
        }

        // When user asks for all group orders: group_discover returns list — fetch full status for each and show all
        if (fnName === 'group_discover' && data?.orders?.length > 0) {
          try {
            const orders = data.orders as { code: string }[];
            const snapshots: GroupOrderSnapshot[] = [];
            for (const o of orders) {
              if (!o?.code) continue;
              try {
                const go = await getGroupOrderStatus(o.code);
                if (!go.isImport) snapshots.push(toGroupSnapshot(go));
              } catch (e) {
                logInfo('group_discover: skip failed status fetch', { traceId: toolContext.traceId, code: o.code, err: e });
              }
            }
            if (snapshots.length > 0) collectedGroupOrders = snapshots;
          } catch (e) {
            logInfo('group_discover: could not load all order statuses', { traceId: toolContext.traceId, err: e });
          }
        }

        // When user asks for all import orders: import_order_list returns list — fetch full status for each and show all
        if (fnName === 'import_order_list' && data?.orders?.length > 0) {
          try {
            const orders = data.orders as { code: string }[];
            const snapshots: ImportOrderSnapshot[] = [];
            for (const o of orders) {
              if (!o?.code) continue;
              try {
                const go = await getGroupOrderStatus(o.code);
                if (go.isImport) snapshots.push(toImportSnapshot(go));
              } catch (e) {
                logInfo('import_order_list: skip failed status fetch', { traceId: toolContext.traceId, code: o.code, err: e });
              }
            }
            if (snapshots.length > 0) collectedImportOrders = snapshots;
          } catch (e) {
            logInfo('import_order_list: could not load all order statuses', { traceId: toolContext.traceId, err: e });
          }
        }

        // Other tools that return full status (group_add_item, group_join, order_status, etc.): add so block is shown
        const listTools = ['group_discover', 'import_order_list'];
        const singleStatusTools = ['group_status', 'import_order_status'];
        if (
          data?.code &&
          data?.moqTarget !== undefined &&
          !listTools.includes(fnName) &&
          !singleStatusTools.includes(fnName)
        ) {
          if (data?.isImport === true) {
            collectedImportOrders = upsertByCode(collectedImportOrders, toImportSnapshot(data));
          } else {
            collectedGroupOrders = upsertByCode(collectedGroupOrders, toGroupSnapshot(data));
          }
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
  return { reply: sanitizeReplyForDisplay('I ran into a complex situation. Could you simplify your request?') };
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
