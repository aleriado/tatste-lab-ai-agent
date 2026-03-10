"use client";

import type { GroupOrderSnapshot } from "@taste-labs/shared";
import type { UiText } from "../page";

interface Props {
  groupOrder: GroupOrderSnapshot;
  t: UiText;
  /** When true, show "Import Order" label and treat as single-participant (same UI as group order). */
  isImportOrder?: boolean;
}

export default function GroupOrderStatus({ groupOrder, t, isImportOrder }: Props) {
  const progress = groupOrder.moqTarget > 0
    ? Math.min(100, Math.round((groupOrder.moqCurrent / groupOrder.moqTarget) * 100))
    : 0;
  
  const hasSurfaces = groupOrder.surfaces && groupOrder.surfaces.length > 0;
  const hasItems = groupOrder.progress && groupOrder.progress.productLayers.length > 0;
  const orderLabel = isImportOrder ? t.importOrder : t.groupOrder;

  return (
    <div className="group-order-status">
      <div className="group-order-header">
        <span className="group-order-label">{orderLabel}</span>
        <span className="group-order-code">{groupOrder.code}</span>
      </div>
      
      <div className="group-order-progress-bar">
        <div className="group-order-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      
      <div className="group-order-details">
        <span>{groupOrder.participantCount} {t.participants}</span>
        <span className={`group-order-badge ${groupOrder.status.toLowerCase()}`}>
          {groupOrder.status}
        </span>
      </div>
      
      {groupOrder.manufacturer && (
        <div className="group-order-meta-row">
          Manufacturer: <strong>{groupOrder.manufacturer}</strong>
        </div>
      )}

      {/* Show MOQ surfaces when no products added yet */}
      {!hasSurfaces && !hasItems && (
        <div className="group-order-moq-card">
          <div className="group-order-moq-title">MOQ Configuration</div>
          <div className="group-order-moq-value">
            MOQ Surfaces: <strong>{groupOrder.moqSurfaces}</strong> pallet{groupOrder.moqSurfaces > 1 ? 's' : ''}
          </div>
          <div className="group-order-moq-hint">
            Add products to start filling the group order
          </div>
        </div>
      )}

      {/* Show detailed surface and layer information */}
      {hasSurfaces && (
        <div className="group-order-surfaces-card">
          <div className="group-order-surfaces-title">
            Surfaces & Layers
            {groupOrder.surfaceMaxLayers && (
              <span className="group-order-surfaces-subtitle">
                (Max {groupOrder.surfaceMaxLayers} layers per surface)
              </span>
            )}
          </div>
          
          <div className="group-order-moq-info">
            MOQ: <strong>{groupOrder.moqSurfaces}</strong> surface{groupOrder.moqSurfaces > 1 ? 's' : ''} (pallet{groupOrder.moqSurfaces > 1 ? 's' : ''})
          </div>

          {groupOrder.surfaces && groupOrder.surfaces.map((surface) => (
            <div key={surface.surfaceIndex} className="group-order-surface">
              <div className="group-order-surface-header">
                <span className="group-order-surface-title">
                  Surface {surface.surfaceIndex + 1}
                </span>
                <span className={`group-order-surface-status ${surface.status}`}>
                  {surface.status}
                </span>
              </div>
              
              {surface.layers.length === 0 ? (
                <div className="group-order-layer-empty">No layers yet</div>
              ) : (
                <div className="group-order-layers">
                  {surface.layers.map((layer) => (
                    <div key={layer.layerIndex} className="group-order-layer">
                      <div className="group-order-layer-header">
                        <span className="group-order-layer-title">
                          Layer {layer.layerIndex + 1}
                        </span>
                        <span className={`group-order-layer-status ${layer.status}`}>
                          {layer.status}
                        </span>
                      </div>
                      <div className="group-order-layer-content">
                        <div className="group-order-layer-product">
                          Product: <strong>{layer.productName || layer.productId}</strong>
                        </div>
                        <div className="group-order-layer-stats">
                          <span>
                            {layer.filledUnits} units ({layer.filledBoxes} box{layer.filledBoxes !== 1 ? 'es' : ''})
                          </span>
                          <span className="group-order-layer-dot">•</span>
                          <span>
                            Capacity: {layer.capacityBoxes} box{layer.capacityBoxes !== 1 ? 'es' : ''}
                          </span>
                          {layer.unitPrice && (
                            <>
                              <span className="group-order-layer-dot">•</span>
                              <span className="group-order-layer-price">
                                ₪{layer.unitPrice}/unit
                                {layer.capacityUnits > 0 && (
                                  <span className="group-order-layer-price-total">
                                    {' '}(₪{(parseFloat(layer.unitPrice) * layer.capacityUnits).toFixed(2)} full layer)
                                  </span>
                                )}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fallback: Show old progress format if surfaces not available but items exist */}
      {!hasSurfaces && hasItems && (
        <div className="group-order-layer-card">
          <div className="group-order-layer-title">Products Added</div>
          <div className="group-order-moq-info">
            MOQ: <strong>{groupOrder.moqSurfaces}</strong> surface{groupOrder.moqSurfaces > 1 ? 's' : ''}
          </div>
          <div className="group-order-layer-list">
            {groupOrder.progress?.productLayers.map((layer, idx) => (
              <div className="group-order-layer-item" key={layer.productId}>
                <div className="group-order-layer-product-name">
                  Product {idx + 1}: {layer.productId}
                </div>
                <div className="group-order-layer-stats">
                  {layer.quantity} units ({Math.ceil(layer.quantity / layer.boxesPerLayer)} box{Math.ceil(layer.quantity / layer.boxesPerLayer) !== 1 ? 'es' : ''})
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {groupOrder.expiresAt && (
        <div className="group-order-deadline">
          {t.expires}: {new Date(groupOrder.expiresAt).toLocaleString()}
        </div>
      )}

      {groupOrder.participantCosts && groupOrder.participantCosts.length > 0 && (
        <div className="group-order-participant-costs">
          <div className="group-order-participant-costs-title">Cost per Participant</div>
          {groupOrder.participantCosts.map((p, idx) => (
            <div key={p.customerId} className="group-order-participant-cost-row">
              <div className="group-order-participant-header">
                <span className="group-order-participant-label">{p.customerId}</span>
                <span className="group-order-participant-amount">₪{p.total}</span>
              </div>
              {p.products.map((prod) => (
                <div key={prod.name} className="group-order-participant-product-row">
                  <span className="group-order-participant-product-name">{prod.name}</span>
                  <span className="group-order-participant-product-detail">
                    {prod.units} units · ₪{prod.cost}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <div className="group-order-participant-cost-total">
            Total: ₪{groupOrder.participantCosts
              .reduce((sum, p) => sum + parseFloat(p.total), 0)
              .toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}
