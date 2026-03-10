"use client";

import type { CartSnapshot } from "@taste-labs/shared";
import type { UiText } from "../page";

interface Props {
  cart: CartSnapshot;
  onAction?: (text: string) => void;
  disabled?: boolean;
  t: UiText;
}

export default function CartSummary({ cart, onAction, disabled, t }: Props) {
  if (cart.items.length === 0) {
    return <div className="cart-summary empty">{t.emptyCart}</div>;
  }

  return (
    <div className="cart-summary">
      <div className="cart-header-row">
        <span className="cart-label">{t.shoppingCart}</span>
        <span className="cart-count">{cart.itemCount} {t.items}</span>
      </div>
      <div className="cart-items">
        {cart.items.map((item, idx) => {
          const isStock = item.orderType === "STOCK" || item.orderTypeLabel === "Stock";
          const orderLabel = isStock ? t.cartLabelStock : t.cartLabelGeneral;
          return (
            <div key={`${item.productId}-${item.variantId ?? ""}-${idx}`} className="cart-item-row">
              <div className="cart-item-info">
                <span className="cart-item-name">{item.name}</span>
                <span className="cart-item-type-badge" aria-label={orderLabel}>{orderLabel}</span>
                <span className="cart-item-qty">x{item.quantity}</span>
              </div>
              <span className="cart-item-price">{cart.currency} {item.lineTotal}</span>
            </div>
          );
        })}
      </div>
      <div className="cart-total-row">
        <span>{t.total}</span>
        <span className="cart-total-amount">{cart.currency} {cart.total}</span>
      </div>
      <div className="cart-actions">
        <button className="product-action-btn add" onClick={() => onAction?.("Checkout")} type="button" disabled={disabled}>
          {t.checkout}
        </button>
        <button className="product-action-btn detail" onClick={() => onAction?.("Clear my cart")} type="button" disabled={disabled}>
          {t.clearCart}
        </button>
      </div>
    </div>
  );
}
