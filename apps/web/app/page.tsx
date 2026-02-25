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
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4000";

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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      from: "bot",
      text: "Hi! I'm your Taste Labs concierge. Tell me what you're in the mood for and I'll find something great for you.",
      suggestions: ["What do you recommend?", "Show me what you have", "מה יש לכם?"],
    },
  ]);
  const [input, setInput] = useState("");
  const [channelUserId, setChannelUserId] = useState<string>("web-anon");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChannelUserId(getOrCreateChannelUserId());
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setMessages((prev) => [...prev, { from: "user", text: trimmed }]);
    setInput("");
    setIsSending(true);

    const payload: InboundMessagePayload = {
      channel: "web",
      channel_user_id: channelUserId,
      text: trimmed,
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
        {
          from: "bot",
          text: "Something went wrong talking to the orchestrator. Please check that it's running.",
        },
      ]);
    } finally {
      setIsSending(false);
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
      <div className="chat-card">
        <div className="chat-header">
          <div>
            <div className="chat-title">Taste Labs Concierge</div>
            <div className="chat-subtitle">AI Shopping Assistant</div>
          </div>
          <span className="chat-badge">M2</span>
        </div>

        <div className="chat-messages">
          {messages.map((m, idx) => (
            <div key={idx}>
              <div className={`message-row ${m.from}`}>
                <div className={`message-bubble ${m.from}`}>{m.text}</div>
              </div>

              {/* Product cards */}
              {m.cards && m.cards.length > 0 && (
                <div className="product-cards-grid">
                  {m.cards.map((card, ci) => (
                    <ProductCard
                      key={card.id}
                      product={card}
                      index={ci}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              )}

              {/* Cart summary */}
              {m.cart && <CartSummary cart={m.cart} onAction={handleAction} />}

              {/* Group order status */}
              {m.groupOrder && <GroupOrderStatus groupOrder={m.groupOrder} />}

              {/* Payment link */}
              {m.link && <LinkBubble link={m.link} />}

              {/* Quick action suggestions */}
              {m.suggestions && m.suggestions.length > 0 && (
                <QuickActions suggestions={m.suggestions} onAction={handleAction} />
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-footer">
          <form className="chat-form" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              placeholder='Try: "What do you recommend?" or "מה יש לכם?"'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isSending}
              aria-label="Chat message input"
            />
            <button className="chat-button" type="submit" disabled={isSending}>
              {isSending ? "..." : "Send"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
