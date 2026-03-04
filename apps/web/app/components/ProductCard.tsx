"use client";

import { useState, useEffect, useRef } from "react";
import type { ProductCard as ProductCardType } from "@taste-labs/shared";
import type { UiText } from "../page";

interface Props {
  product: ProductCardType;
  index: number;
  onAction?: (text: string) => void;
  disabled?: boolean;
  loading?: boolean;
  t: UiText;
}

export default function ProductCard({ product, index, onAction, disabled, loading, t }: Props) {
  const [showModal, setShowModal] = useState(false);
  const addGuardRef = useRef(false);

  useEffect(() => {
    if (showModal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [showModal]);

  // Reset local click guard whenever parent loading flag is cleared
  useEffect(() => {
    if (!loading) {
      addGuardRef.current = false;
    }
  }, [loading]);

  const addText = `Add ${product.name} to cart [productId:${product.id}]`;
  const normalizedType = (product.type ?? "").toLowerCase();
  const isDigital = /download|digital|להורדה/.test(normalizedType) || product.isDownloadable;
  const moqBoxes = product.boxesPerLayer ?? product.boxesPerSurface;

  const specRows: Array<{ label: string; value?: string | number | boolean }> = [
    { label: t.manufacturer, value: product.manufacturer },
    { label: t.brand, value: product.brand },
    { label: t.countryOfOrigin, value: product.countryOfOrigin },
    { label: t.sku, value: product.sku },
    { label: t.barcode, value: product.barcode },
    { label: t.weight, value: product.weight },
    { label: t.stockUnits, value: product.inventory },
    ...(!isDigital
      ? [
          { label: t.unitsPerBox, value: product.unitsPerBox },
          { label: t.boxesPerLayer, value: product.boxesPerLayer },
          { label: t.layersPerSurface, value: product.layersPerSurface },
          { label: t.boxesPerSurface, value: product.boxesPerSurface },
          { label: t.moqBoxes, value: moqBoxes }
        ]
      : [])
  ];

  const displayValue = (value?: string | number | boolean): string => {
    if (value === undefined || value === null) return t.notAvailable;
    const text = String(value).trim();
    return text.length > 0 ? text : t.notAvailable;
  };

  const handleAdd = () => {
    if (loading || disabled || addGuardRef.current) return;
    addGuardRef.current = true;
    onAction?.(addText);
  };

  return (
    <>
      <div className="product-card">
        {product.imageUrl && (
          <div className="product-image-wrap">
            <img src={product.imageUrl} alt={product.name} className="product-image" loading="lazy" />
          </div>
        )}
        <div className="product-info">
          <div className="product-name">{product.name}</div>
          {product.price && <div className="product-price">₪{product.price}</div>}
          {product.shortDescription && (
            <div className="product-desc">{product.shortDescription}</div>
          )}
          <div className="product-actions">
            <button
              className={`product-action-btn add ${loading ? "loading" : ""}`}
              onClick={handleAdd}
              type="button"
              disabled={disabled || loading}
            >
              {loading ? <span className="btn-spinner" /> : t.addToCart}
            </button>
            <button
              className="product-action-btn detail"
              onClick={() => setShowModal(true)}
              type="button"
            >
              {t.details}
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)} role="dialog" aria-modal="true" aria-label={`${t.details} - ${product.name}`}>
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
                  {product.inStock ? t.inStock : t.outOfStock}
                </div>
              )}
              {(product.detailedDescription ?? product.description ?? product.shortDescription) && (
                <div
                  className="modal-description"
                  dangerouslySetInnerHTML={{
                    __html: product.detailedDescription ?? product.description ?? product.shortDescription ?? ''
                  }}
                />
              )}
              <div className="modal-specs">
                <div className="modal-specs-title">{t.productSpec}</div>
                <div className="modal-specs-grid">
                  {specRows.map((row) => (
                    <div key={row.label} className="modal-spec-row">
                      <span className="modal-spec-label">{row.label}</span>
                      <span className="modal-spec-value">{displayValue(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button
                className="modal-add-btn"
                onClick={() => {
                  handleAdd();
                  if (!loading) {
                    setShowModal(false);
                  }
                }}
                type="button"
                disabled={disabled || loading}
              >
                {t.addToCart}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
