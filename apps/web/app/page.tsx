"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  InboundMessagePayload,
  OrchestratorReply,
  ProductCard as ProductCardType,
  CartSnapshot,
  CheckoutLink,
  GroupOrderSnapshot,
} from "@taste-labs/shared";
import ProductCard from "./components/ProductCard";
import CartSummary from "./components/CartSummary";
import QuickActions from "./components/QuickActions";
import LinkBubble from "./components/LinkBubble";
import GroupOrderStatus from "./components/GroupOrderStatus";

type Lang = "en" | "he";

export interface UiText {
  title: string; subtitle: string; placeholder: string; send: string;
  welcome: string; suggest1: string; suggest2: string; suggest3: string; suggest4: string; suggest5: string;
  thinking: string; error: string;
  addToCart: string; details: string; inStock: string; outOfStock: string;
  productSpec: string; manufacturer: string; barcode: string; weight: string;
  stockUnits: string; unitsPerBox: string; boxesPerLayer: string; layersPerSurface: string; boxesPerSurface: string; moqBoxes: string;
  notAvailable: string;
  shoppingCart: string; items: string; total: string; checkout: string;
  clearCart: string; emptyCart: string; completePayment: string;
  dueNow: string; dueLater: string;
  groupOrder: string; expires: string; participants: string;
}

type ChatMessage = {
  from: "user" | "bot";
  text: string;
  cards?: ProductCardType[];
  cart?: CartSnapshot;
  suggestions?: string[];
  link?: CheckoutLink;
  groupOrder?: GroupOrderSnapshot;
};

const ORCHESTRATOR_BASE =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:5501";

const UI_TEXT: Record<Lang, {
  title: string; subtitle: string; placeholder: string; send: string;
  welcome: string; suggest1: string; suggest2: string; suggest3: string; suggest4: string; suggest5: string;
  thinking: string; error: string;
  addToCart: string; details: string; inStock: string; outOfStock: string;
  productSpec: string; manufacturer: string; barcode: string; weight: string;
  stockUnits: string; unitsPerBox: string; boxesPerLayer: string; layersPerSurface: string; boxesPerSurface: string; moqBoxes: string;
  notAvailable: string;
  shoppingCart: string; items: string; total: string; checkout: string;
  clearCart: string; emptyCart: string; completePayment: string;
  dueNow: string; dueLater: string;
  groupOrder: string; expires: string; participants: string;
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
    addToCart: "Add to cart",
    details: "Details",
    inStock: "In Stock",
    outOfStock: "Out of Stock",
    productSpec: "Product Specs",
    manufacturer: "Manufacturer",
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
    dueNow: "Due now",
    dueLater: "Due later",
    groupOrder: "Group Order",
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
    addToCart: "הוסף לסל",
    details: "פרטים",
    inStock: "במלאי",
    outOfStock: "אזל מהמלאי",
    productSpec: "מפרט מוצר",
    manufacturer: "יצרן",
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
    dueNow: "לתשלום עכשיו",
    dueLater: "לתשלום מאוחר יותר",
    groupOrder: "הזמנה קבוצתית",
    expires: "פג תוקף",
    participants: "משתתפים",
  },
};

function getOrCreateChannelUserId(): string {
  if (typeof window === "undefined") return "web-anon";
  const key = "taste_labs_web_user_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = `web_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(key, id);
  return id;
}

export default function ChatPage() {
  const [lang, setLang] = useState<Lang>("en");
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

  // Translate placeholder tokens based on current language
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

    setMessages((prev) => [...prev, { from: "user", text: trimmed.replace(/\s*\[productId:[^\]]+\]/g, '') }]);
    setInput("");
    setIsSending(true);

    // Enforce response language based on UI selection
    const langInstruction = lang === "he"
      ? "[LANGUAGE: You MUST respond in Hebrew. Keep product names in their original language.] "
      : "[LANGUAGE: You MUST respond in English. Keep product names in their original language.] ";

    const payload: InboundMessagePayload = {
      channel: "web",
      channel_user_id: channelUserId,
      text: langInstruction + trimmed,
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
        ...prev,
        {
          from: "bot",
          text: data.reply,
          cards: data.cards,
          cart: data.cart,
          suggestions: data.suggestions,
          link: data.link,
          groupOrder: data.groupOrder,
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

  const toggleLang = () => setLang((prev) => (prev === "en" ? "he" : "en"));

  return (
    <div className="chat-container">
      <div className="chat-card" dir={lang === "he" ? "rtl" : "ltr"}>
        <div className="chat-header">
          <div>
            <div className="chat-title">{t.title}</div>
            <div className="chat-subtitle">{t.subtitle}</div>
          </div>
          <div className="header-actions">
            <button className="lang-toggle" onClick={toggleLang} type="button" aria-label="Toggle language" title={lang === "en" ? "עברית" : "English"}>
              {lang === "en" ? (
                <svg width="22" height="16" viewBox="0 0 22 16"><rect width="22" height="16" fill="#fff"/><rect y="2.5" width="22" height="2" fill="#0038b8"/><rect y="11.5" width="22" height="2" fill="#0038b8"/><polygon points="11,3.5 12.2,6.5 15.5,6.5 12.8,8.5 13.8,11.5 11,9.5 8.2,11.5 9.2,8.5 6.5,6.5 9.8,6.5" fill="#0038b8"/></svg>
              ) : (
                <svg width="22" height="16" viewBox="0 0 22 16"><rect width="22" height="16" fill="#012169"/><path d="M0,0 L22,16 M22,0 L0,16" stroke="#fff" strokeWidth="2.5"/><path d="M0,0 L22,16 M22,0 L0,16" stroke="#C8102E" strokeWidth="1.5"/><path d="M11,0 V16 M0,8 H22" stroke="#fff" strokeWidth="4"/><path d="M11,0 V16 M0,8 H22" stroke="#C8102E" strokeWidth="2.5"/></svg>
              )}
            </button>
            <span className="chat-badge">M2</span>
          </div>
        </div>

        <div className="chat-messages">
          {messages.map((m, idx) => (
            <div key={idx}>
              <div className={`message-row ${m.from}`}>
                <div className={`message-bubble ${m.from}`}>{tr(m.text)}</div>
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
              {m.groupOrder && <GroupOrderStatus groupOrder={m.groupOrder} t={t} />}
              {m.link && <LinkBubble link={m.link} t={t} />}

              {m.suggestions && m.suggestions.length > 0 && (
                <QuickActions suggestions={m.suggestions.map(tr)} onAction={handleAction} disabled={isSending} />
              )}
            </div>
          ))}

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
