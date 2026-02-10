"use client";

import { FormEvent, useEffect, useState } from "react";
import type { InboundMessagePayload, OrchestratorReply } from "@taste-labs/shared";

type ChatMessage = {
  from: "user" | "bot";
  text: string;
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
      text: "Hi! I’m your Taste Labs concierge. Tell me what you’re in the mood for and I’ll recommend a few options."
    }
  ]);
  const [input, setInput] = useState("");
  const [channelUserId, setChannelUserId] = useState<string>("web-anon");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    setChannelUserId(getOrCreateChannelUserId());
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;

    setMessages((prev) => [...prev, { from: "user", text }]);
    setInput("");
    setIsSending(true);

    const payload: InboundMessagePayload = {
      channel: "web",
      channel_user_id: channelUserId,
      text
    };

    try {
      const res = await fetch(`${ORCHESTRATOR_BASE}/api/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data: OrchestratorReply = await res.json();

      setMessages((prev) => [...prev, { from: "bot", text: data.reply }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          from: "bot",
          text:
            "Something went wrong talking to the orchestrator. Please check that it’s running on http://localhost:4000."
        }
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="chat-container">
      <div className="chat-card">
        <div className="chat-header">
          <div>
            <div className="chat-title">Taste Labs Concierge</div>
            <div className="chat-subtitle">
              M1 – recommend → add to cart → checkout intent
            </div>
          </div>
          <span className="chat-badge">Demo</span>
        </div>

        <div className="chat-messages">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`message-row ${m.from === "user" ? "user" : "bot"}`}
            >
              <div className={`message-bubble ${m.from}`}>{m.text}</div>
            </div>
          ))}
        </div>

        <div className="chat-footer">
          <form className="chat-form" onSubmit={handleSubmit}>
            <input
              className="chat-input"
              placeholder='Try: "What do you recommend?"'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isSending}
            />
            <button className="chat-button" type="submit" disabled={isSending}>
              {isSending ? "Sending…" : "Send"}
            </button>
          </form>
          <div className="chat-hint">
            Recognized intents: RECOMMEND, ADD_TO_CART, CHECKOUT_INTENT, JOIN_GROUP_ORDER.
          </div>
        </div>
      </div>
    </div>
  );
}

