"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  InboundMessagePayload,
  OrchestratorReply,
  ProductCard as ProductCardType,
  CartSnapshot,
  CheckoutLink,
  GroupOrderSnapshot,
  ImportOrderSnapshot,
  ContextMetadata,
  QuantityPrompt,
} from "@taste-labs/shared";
import ProductCard from "./components/ProductCard";
import CartSummary from "./components/CartSummary";
import QuickActions from "./components/QuickActions";
import LinkBubble from "./components/LinkBubble";
import GroupOrderStatus from "./components/GroupOrderStatus";
import QuantityPicker from "./components/QuantityPicker";

type Lang = "en" | "he";

export interface UiText {
  title: string; subtitle: string; placeholder: string; send: string;
  welcome: string; suggest1: string; suggest2: string; suggest3: string; suggest4: string; suggest5: string;
  thinking: string; error: string;
  purchase: string; details: string; inStock: string; outOfStock: string;
  productSpec: string; manufacturer: string; brand: string; countryOfOrigin: string; sku: string; barcode: string; weight: string;
  stockUnits: string; unitsPerBox: string; boxesPerLayer: string; layersPerSurface: string; boxesPerSurface: string; moqBoxes: string;
  notAvailable: string;
  shoppingCart: string; items: string; total: string; checkout: string;
  clearCart: string; emptyCart: string; completePayment: string;
  cartLabelGeneral: string; cartLabelStock: string;
  dueNow: string; dueLater: string;
  groupOrder: string; importOrder: string; expires: string; participants: string;
}

type ChatMessage = {
  from: "user" | "bot";
  text: string;
  cards?: ProductCardType[];
  cart?: CartSnapshot;
  suggestions?: string[];
  link?: CheckoutLink;
  groupOrder?: GroupOrderSnapshot;
  importOrder?: ImportOrderSnapshot;
  groupOrders?: GroupOrderSnapshot[];
  importOrders?: ImportOrderSnapshot[];
  quantityPrompt?: QuantityPrompt;
};

const HEBREW_RANGE = /[\u0590-\u05FF]/;
const LATIN_RANGE = /[A-Za-z]/;
function hasHebrew(text: string): boolean {
  return HEBREW_RANGE.test(text);
}
function hasLatin(text: string): boolean {
  return LATIN_RANGE.test(text);
}
/** Returns true when the text contains Hebrew characters (used for user-input direction detection). */
function isRtlContent(text: string): boolean {
  return hasHebrew(text);
}

/** True if the text is only digits (and optional spaces). Used to avoid flipping layout when user sends e.g. "50". */
function isNumbersOnly(text: string): boolean {
  const t = text.trim().replace(/\s/g, "");
  return t.length > 0 && /^\d+$/.test(t);
}

const ORCHESTRATOR_BASE =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:5501";

const UI_TEXT: Record<Lang, {
  title: string; subtitle: string; placeholder: string; send: string;
  welcome: string; suggest1: string; suggest2: string; suggest3: string; suggest4: string; suggest5: string;
  thinking: string; error: string;
  purchase: string; details: string; inStock: string; outOfStock: string;
  productSpec: string; manufacturer: string; brand: string; countryOfOrigin: string; sku: string; barcode: string; weight: string;
  stockUnits: string; unitsPerBox: string; boxesPerLayer: string; layersPerSurface: string; boxesPerSurface: string; moqBoxes: string;
  notAvailable: string;
  shoppingCart: string; items: string; total: string; checkout: string;
  clearCart: string; emptyCart: string; completePayment: string;
  cartLabelGeneral: string; cartLabelStock: string;
  dueNow: string; dueLater: string;
  groupOrder: string; importOrder: string; expires: string; participants: string;
}> = {
  en: {
    title: "Taste Labs Concierge",
    subtitle: "AI Shopping Assistant",
    placeholder: 'Try: "What do you recommend?"',
    send: "Send",
    welcome: "Hi! I'm your Taste Labs concierge. Tell me what you're in the mood for and I'll find something great for you.",
    suggest1: "What do you recommend?",
    suggest2: "Show me what you have",
    suggest3: "What's popular?",
    suggest4: "Create a group order",
    suggest5: "Show open group orders",
    thinking: "Thinking...",
    error: "Something went wrong. Please try again.",
    purchase: "Purchase",
    details: "Details",
    inStock: "In Stock",
    outOfStock: "Out of Stock",
    productSpec: "Product Specs",
    manufacturer: "Manufacturer",
    brand: "Brand",
    countryOfOrigin: "Country of Origin",
    sku: "SKU",
    barcode: "Barcode",
    weight: "Weight",
    stockUnits: "Inventory",
    unitsPerBox: "Units per box",
    boxesPerLayer: "Boxes per layer",
    layersPerSurface: "Layers per pallet",
    boxesPerSurface: "Boxes per pallet",
    moqBoxes: "MOQ (boxes)",
    notAvailable: "N/A",
    shoppingCart: "Shopping Cart",
    items: "items",
    total: "Total",
    checkout: "Checkout",
    clearCart: "Clear cart",
    emptyCart: "Your cart is empty.",
    completePayment: "Complete Payment",
    cartLabelGeneral: "General",
    cartLabelStock: "Stock",
    dueNow: "Due now",
    dueLater: "Due later",
    groupOrder: "Group Order",
    importOrder: "Import Order",
    expires: "Expires",
    participants: "participants",
  },
  he: {
    title: "טייסט לאבס קונסיירז'",
    subtitle: "עוזר קניות חכם",
    placeholder: 'נסו: "מה אתם ממליצים?"',
    send: "שלח",
    welcome: "היי! אני הקונסיירז' של טייסט לאבס. ספרו לי מה בא לכם ואמצא לכם משהו מעולה.",
    suggest1: "מה אתם ממליצים?",
    suggest2: "הראו לי מה יש לכם",
    suggest3: "מה פופולרי?",
    suggest4: "צור הזמנה קבוצתית",
    suggest5: "הצג הזמנות קבוצתיות פתוחות",
    thinking: "חושב...",
    error: "משהו השתבש. נסו שוב.",
    purchase: "רכישה",
    details: "פרטים",
    inStock: "במלאי",
    outOfStock: "אזל מהמלאי",
    productSpec: "מפרט מוצר",
    manufacturer: "יצרן",
    brand: "מותג",
    countryOfOrigin: "ארץ מקור",
    sku: "מק״ט",
    barcode: "ברקוד",
    weight: "משקל",
    stockUnits: "מלאי",
    unitsPerBox: "יחידות בקרטון",
    boxesPerLayer: "קרטונים בשכבה",
    layersPerSurface: "שכבות במשטח",
    boxesPerSurface: "קרטונים במשטח",
    moqBoxes: "MOQ (קרטונים)",
    notAvailable: "לא זמין",
    shoppingCart: "סל קניות",
    items: "פריטים",
    total: "סה״כ",
    checkout: "לתשלום",
    clearCart: "נקה סל",
    emptyCart: "הסל שלך ריק.",
    completePayment: "השלם תשלום",
    cartLabelGeneral: "רגיל",
    cartLabelStock: "סטוק",
    dueNow: "לתשלום עכשיו",
    dueLater: "לתשלום מאוחר יותר",
    groupOrder: "הזמנה קבוצתית",
    importOrder: "הזמנת ייבוא",
    expires: "פג תוקף",
    participants: "משתתפים",
  },
};

const WEB_USER_ID_KEY = "taste_labs_web_user_id";
const WEB_USER_ID_COOKIE_DAYS = 365;

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[^\\w]/g, "\\$&") + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days: number): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; SameSite=Lax`;
}

/** Persists web identity so the backend can resolve the same Customer (and DB cart). Stored in both cookie and localStorage so clearing only one does not lose the cart. Clearing both (e.g. Ctrl+Shift+Del) creates a new anonymous user; login would be needed for cross-session persistence. */
function getOrCreateChannelUserId(): string {
  if (typeof window === "undefined") return "web-anon";
  const fromCookie = getCookie(WEB_USER_ID_KEY);
  if (fromCookie) {
    try { window.localStorage.setItem(WEB_USER_ID_KEY, fromCookie); } catch { /* ignore */ }
    return fromCookie;
  }
  const fromStorage = window.localStorage.getItem(WEB_USER_ID_KEY);
  if (fromStorage) {
    setCookie(WEB_USER_ID_KEY, fromStorage, WEB_USER_ID_COOKIE_DAYS);
    return fromStorage;
  }
  const id = `web_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(WEB_USER_ID_KEY, id);
  setCookie(WEB_USER_ID_KEY, id, WEB_USER_ID_COOKIE_DAYS);
  return id;
}

export default function ChatPage() {
  // Language auto-detected from user input; defaults to Hebrew (Hebrew-first market)
  const [lang, setLang] = useState<Lang>("he");
  const t = UI_TEXT[lang];

  const [messages, setMessages] = useState<ChatMessage[]>([{
    from: "bot",
    text: "__WELCOME__",
    suggestions: ["__SUGGEST1__", "__SUGGEST2__", "__SUGGEST3__", "__SUGGEST4__", "__SUGGEST5__"],
  }]);
  const [input, setInput] = useState("");
  const [channelUserId, setChannelUserId] = useState<string>("web-anon");
  const [isSending, setIsSending] = useState(false);
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendLockRef = useRef(false);

  function tr(text: string): string {
    return text
      .replace("__WELCOME__", t.welcome)
      .replace("__SUGGEST1__", t.suggest1)
      .replace("__SUGGEST2__", t.suggest2)
      .replace("__SUGGEST3__", t.suggest3)
      .replace("__SUGGEST4__", t.suggest4)
      .replace("__SUGGEST5__", t.suggest5);
  }

  useEffect(() => {
    setChannelUserId(getOrCreateChannelUserId());
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sendLockRef.current) return;
    sendLockRef.current = true;

    // Track per-product loading
    const productIdMatch = trimmed.match(/\[productId:([^\]]+)\]/);
    if (productIdMatch) {
      setLoadingProductId(productIdMatch[1]);
    }

    // Auto-detect language from user input and switch UI direction. Do NOT change direction when user sends only numbers (e.g. "50") so positions stay the same (user left, bot right in RTL).
    if (!isNumbersOnly(trimmed)) {
      const detectedLang: Lang = hasHebrew(trimmed) ? "he" : "en";
      setLang(detectedLang);
    }

    setMessages((prev) => [...prev, { from: "user", text: trimmed.replace(/\s*\[productId:[^\]]+\]/g, '') }]);
    setInput("");
    setIsSending(true);

    // M2: Build context metadata from current UI state
    const contextMetadata: ContextMetadata = {
      currentPage: "catalog",
      userType: "private_consumer",
    };

    const payload: InboundMessagePayload = {
      channel: "web",
      channel_user_id: channelUserId,
      text: trimmed,
      contextMetadata,
    };

    try {
      const res = await fetch(`${ORCHESTRATOR_BASE}/api/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: OrchestratorReply = await res.json();

      setMessages((prev) => [
        // Clear quantityPrompt from all prior messages so the picker only appears once
        ...prev.map((m) => m.quantityPrompt ? { ...m, quantityPrompt: undefined } : m),
        {
          from: "bot",
          text: data.reply,
          cards: data.cards,
          cart: data.cart,
          suggestions: data.suggestions,
          link: data.link,
          groupOrder: data.groupOrder,
          importOrder: data.importOrder,
          groupOrders: data.groupOrders,
          importOrders: data.importOrders,
          quantityPrompt: data.quantityPrompt,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { from: "bot", text: t.error },
      ]);
    } finally {
      setIsSending(false);
      setLoadingProductId(null);
      sendLockRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleAction(text: string) {
    sendMessage(text);
  }

  return (
    <div className="chat-container">
      <div className="chat-card" dir={lang === "he" ? "rtl" : "ltr"}>
        <div className="chat-header">
          <div>
            <div className="chat-title">{t.title}</div>
            <div className="chat-subtitle">{t.subtitle}</div>
          </div>
          <div className="header-actions">
            <span className="chat-badge">M2</span>
          </div>
        </div>

        <div className="chat-messages">
          {messages.map((m, idx) => {
            // Bot bubbles follow the session language; user bubbles use content detection.
            const msgRtl = m.from === "user" ? isRtlContent(m.text) : lang === "he";
            return (
            <div key={idx}>
              <div className={`message-row ${m.from}`}>
                <div
                  className={`message-bubble ${m.from}`}
                  dir={msgRtl ? "rtl" : "ltr"}
                  style={msgRtl ? { textAlign: "right" } : { textAlign: "left" }}
                >{tr(m.text)}</div>
              </div>

              {m.cards && m.cards.length > 0 && (
                <div className="product-cards-grid">
                  {m.cards.map((card, ci) => (
                    <ProductCard
                      key={card.id}
                      product={card}
                      index={ci}
                      onAction={handleAction}
                      disabled={isSending}
                      loading={loadingProductId === card.id}
                      t={t}
                    />
                  ))}
                </div>
              )}

              {m.cart && <CartSummary cart={m.cart} onAction={handleAction} disabled={isSending} t={t} />}
              {m.groupOrders && m.groupOrders.length > 0 ? (
                m.groupOrders.map((go) => (
                  <GroupOrderStatus key={go.code} groupOrder={go} t={t} />
                ))
              ) : m.groupOrder ? (
                <GroupOrderStatus groupOrder={m.groupOrder} t={t} />
              ) : null}
              {m.importOrders && m.importOrders.length > 0 ? (
                m.importOrders.map((io) => (
                  <GroupOrderStatus key={io.code} groupOrder={io} t={t} isImportOrder />
                ))
              ) : m.importOrder ? (
                <GroupOrderStatus groupOrder={m.importOrder} t={t} isImportOrder />
              ) : null}
              {m.link && <LinkBubble link={m.link} t={t} />}

              {m.suggestions && m.suggestions.length > 0 && (
                <QuickActions suggestions={m.suggestions.map(tr)} onAction={handleAction} disabled={isSending} />
              )}

              {m.quantityPrompt && (
                <QuantityPicker
                  prompt={m.quantityPrompt}
                  onConfirm={handleAction}
                  disabled={isSending}
                  lang={lang}
                />
              )}
            </div>
            );
          })}

          {isSending && (
            <div className="message-row bot">
              <div className="typing-indicator">
                <div className="typing-dots">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
                <span className="typing-text">{t.thinking}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="chat-footer">
          <form className="chat-form" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              ref={inputRef}
              placeholder={t.placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isSending}
              aria-label="Chat message input"
            />
            <button className="chat-button" type="submit" disabled={isSending}>
              {isSending ? "..." : t.send}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
