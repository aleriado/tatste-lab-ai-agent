"use client";

import { useState } from "react";
import type { QuantityPrompt } from "@taste-labs/shared";

interface Props {
  prompt: QuantityPrompt;
  onConfirm: (text: string) => void;
  disabled?: boolean;
  lang: "en" | "he";
}

const LABELS = {
  en: {
    boxes: "boxes",
    minLabel: (n: number) => `min ${n}`,
    confirm: "Add to cart",
    units: (n: number, uPerBox: number) => `= ${n * uPerBox} units`,
  },
  he: {
    boxes: "קרטונים",
    minLabel: (n: number) => `מינימום ${n}`,
    confirm: "הוסף לסל",
    units: (n: number, uPerBox: number) => `= ${n * uPerBox} יחידות`,
  },
} as const;

export default function QuantityPicker({ prompt, onConfirm, disabled, lang }: Props) {
  const [qty, setQty] = useState(prompt.default);
  const l = LABELS[lang];

  function decrement() {
    setQty((q) => Math.max(prompt.min, q - 1));
  }
  function increment() {
    setQty((q) => q + 1);
  }
  function handleConfirm() {
    onConfirm(`${qty} boxes [productId:${prompt.productId}]`);
  }

  return (
    <div className="quantity-picker">
      <div className="quantity-picker-label">
        <span className="quantity-picker-product">{prompt.productName}</span>
        <span className="quantity-picker-moq">{l.minLabel(prompt.min)}</span>
      </div>
      <div className="quantity-picker-controls">
        <button
          className="qty-btn"
          onClick={decrement}
          disabled={disabled || qty <= prompt.min}
          type="button"
          aria-label="decrease"
        >
          −
        </button>
        <span className="qty-value">
          {qty} <span className="qty-unit">{l.boxes}</span>
        </span>
        <button
          className="qty-btn"
          onClick={increment}
          disabled={disabled}
          type="button"
          aria-label="increase"
        >
          +
        </button>
        {prompt.pricePerUnit && (
          <span className="qty-price">₪{prompt.pricePerUnit}</span>
        )}
        {prompt.unitsPerBox && (
          <span className="qty-units-hint">{l.units(qty, prompt.unitsPerBox)}</span>
        )}
        <button
          className="qty-confirm-btn"
          onClick={handleConfirm}
          disabled={disabled}
          type="button"
        >
          {l.confirm}
        </button>
      </div>
    </div>
  );
}
