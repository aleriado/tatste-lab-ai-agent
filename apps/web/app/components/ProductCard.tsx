"use client";

import { useState, useEffect } from "react";
import type { ProductCard as ProductCardType } from "@taste-labs/shared";

interface Props {
  product: ProductCardType;
  index: number;
  onAction?: (text: string) => void;
}

export default function ProductCard({ product, index, onAction }: Props) {
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (showModal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [showModal]);

  return (
    <>
      <div className="product-card">
        {product.imageUrl && (
          <div className="product-image-wrap">
            <img src={product.imageUrl} alt={product.name} className="product-image" loading="lazy" />
          </div>
        )}
        <div className="product-info">
          <div className="product-name">
            <span className="product-index">#{index + 1}</span> {product.name}
          </div>
          {product.price && <div className="product-price">₪{product.price}</div>}
          {product.shortDescription && (
            <div className="product-desc">{product.shortDescription}</div>
          )}
          <div className="product-actions">
            <button className="product-action-btn add" onClick={() => onAction?.(`Add ${product.name} to cart`)} type="button">
              Add to cart
            </button>
            <button className="product-action-btn detail" onClick={() => setShowModal(true)} type="button">
              Details
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)} role="dialog" aria-modal="true" aria-label={`Details for ${product.name}`}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowModal(false)} type="button" aria-label="Close">✕</button>
            {product.imageUrl && (
              <img src={product.imageUrl} alt={product.name} className="modal-image" />
            )}
            <div className="modal-body">
              <h2 className="modal-title">{product.name}</h2>
              {product.categories && product.categories.length > 0 && (
                <div className="modal-categories">
                  {product.categories.map((c) => (<span key={c} className="modal-category-tag">{c}</span>))}
                </div>
              )}
              {product.price && <div className="modal-price">₪{product.price}</div>}
              {product.inStock !== undefined && (
                <div className={`modal-stock ${product.inStock ? "in" : "out"}`}>
                  {product.inStock ? "In Stock" : "Out of Stock"}
                </div>
              )}
              {product.description && (
                <div className="modal-description">{product.description}</div>
              )}
              {!product.description && product.shortDescription && (
                <div className="modal-description">{product.shortDescription}</div>
              )}
              <button className="modal-add-btn" onClick={() => { onAction?.(`Add ${product.name} to cart`); setShowModal(false); }} type="button">
                Add to cart
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
