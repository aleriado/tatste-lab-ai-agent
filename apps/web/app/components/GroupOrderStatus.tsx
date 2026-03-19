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
  const hasSurfaces = groupOrder.surfaces && groupOrder.surfaces.length > 0;
  const hasItems = groupOrder.progress && groupOrder.progress.productLayers.length > 0;
  const orderLabel = isImportOrder ? t.importOrder : t.groupOrder;

  const moqSurfaces = Math.max(1, groupOrder.moqSurfaces ?? groupOrder.moqTarget ?? 1);
  const surfaceMaxLayers = groupOrder.surfaceMaxLayers ?? (hasSurfaces && groupOrder.surfaces?.length
    ? Math.max(...groupOrder.surfaces.map((s) => s.maxLayers))
    : 1);
  const totalLayersForMoq = moqSurfaces * surfaceMaxLayers;

  const fullLayersCount = hasSurfaces && groupOrder.surfaces
    ? groupOrder.surfaces.reduce((sum, s) => sum + s.layers.filter((l) => l.status === 'full').length, 0)
    : 0;
  const progress = totalLayersForMoq > 0
    ? Math.min(100, Math.round((fullLayersCount * 100) / totalLayersForMoq))
    : 0;

  const openBoxesTotal = hasSurfaces && groupOrder.surfaces
    ? groupOrder.surfaces.reduce(
        (s, surf) =>
          s +
          surf.layers.reduce(
            (ls, l) => ls + (l.openBoxes ?? Math.max(0, l.capacityBoxes - l.filledBoxes)),
            0
          ),
        0
      )
    : 0;

  const surfaceLayerProgress =
    hasSurfaces && groupOrder.surfaces
      ? groupOrder.surfaces.map((s) => {
          const fullLayers = s.layers.filter((l) => l.status === 'full').length;
          const totalLayers = s.layers.length;
          return { surfaceIndex: s.surfaceIndex, fullLayers, totalLayers, isComplete: s.status === 'full' };
        })
      : [];

  return (
    <div className="group-order-status">
      <div className="group-order-header">
        <span className="group-order-label">{orderLabel}</span>
        <span className="group-order-code">{groupOrder.code}</span>
      </div>

      {/* Progress = full layers * 100 / (moq surfaces * layers per surface) */}
      <div className="group-order-progress-section">
        <div className="group-order-progress-label">
          Layer progress
        </div>
        <div className="group-order-progress-bar">
          <div className="group-order-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="group-order-progress-caption">
          <strong>{fullLayersCount}</strong> of <strong>{totalLayersForMoq}</strong> layers accounted for.
          {openBoxesTotal > 0 && (
            <> <strong>{openBoxesTotal}</strong> box{openBoxesTotal !== 1 ? 'es' : ''} still available for new participants.</>
          )}
        </div>
        {surfaceLayerProgress.length > 0 && surfaceLayerProgress.some((s) => !s.isComplete) && (
          <div className="group-order-progress-per-surface">
            {surfaceLayerProgress
              .filter((s) => !s.isComplete)
              .map((s) => (
                <span key={s.surfaceIndex} className="group-order-progress-surface-line">
                  Surface {s.surfaceIndex + 1}: {s.fullLayers} of {s.totalLayers} layers full
                </span>
              ))}
          </div>
        )}
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

      {/* Spec: MOQ = minimum surfaces for order to ship. Empty state. */}
      {!hasSurfaces && !hasItems && (
        <div className="group-order-moq-card">
          <div className="group-order-moq-title">
            {isImportOrder ? 'Drop-import order' : 'Group order'}
          </div>
          <div className="group-order-moq-value">
            Surface{groupOrder.moqSurfaces > 1 ? 's' : ''} to fill: <strong>{groupOrder.moqSurfaces}</strong>
            {!isImportOrder && (
              <span className="group-order-moq-hint-inline">
                {' '}(order ships when all surfaces are fully committed)
              </span>
            )}
          </div>
          <div className="group-order-moq-hint">
            {isImportOrder
              ? 'Add products in whole layers to fill your surface.'
              : 'Add products to start filling the group order.'}
          </div>
        </div>
      )}

      {/* Spec 4.8: Layer table — Layer | Product | Total boxes | Used boxes | Open boxes | Status */}
      {hasSurfaces && (
        <div className="group-order-surfaces-card">
          <div className="group-order-surfaces-title">
            Surface{groupOrder.surfaces && groupOrder.surfaces.length > 1 ? 's' : ''} &amp; layers
            {groupOrder.surfaceMaxLayers != null && (
              <span className="group-order-surfaces-subtitle">
                {' '}(max {groupOrder.surfaceMaxLayers} layers per surface)
              </span>
            )}
          </div>
          <div className="group-order-moq-info">
            Surface{groupOrder.moqSurfaces > 1 ? 's' : ''} to ship: <strong>{groupOrder.moqSurfaces}</strong>
            {!isImportOrder && (
              <span> (all layers of a surface must be full)</span>
            )}
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
                <div className="group-order-layer-table-wrap">
                  <table className="group-order-layer-table">
                    <thead>
                      <tr>
                        <th>Layer</th>
                        <th>Product</th>
                        <th>Total boxes</th>
                        <th>Used boxes</th>
                        <th>Open boxes</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {surface.layers.map((layer) => {
                        const openBoxes = layer.openBoxes ?? Math.max(0, layer.capacityBoxes - layer.filledBoxes);
                        const statusLabel =
                          layer.status === 'full'
                            ? 'Full'
                            : (layer.participantCount != null && layer.participantCount > 0
                                ? `Open, ${layer.participantCount} user${layer.participantCount !== 1 ? 's' : ''}`
                                : 'Open');
                        return (
                          <tr key={layer.layerIndex} className="group-order-layer-row">
                            <td>Layer {layer.layerIndex + 1}</td>
                            <td><strong>{layer.productName || layer.productId}</strong></td>
                            <td>{layer.capacityBoxes}</td>
                            <td>{layer.filledBoxes}</td>
                            <td>{openBoxes}</td>
                            <td className={`group-order-layer-status ${layer.status}`}>
                              {statusLabel}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {groupOrder.surfaces && (
            <div className="group-order-surface-summary">
              {fullLayersCount} of {totalLayersForMoq} layers accounted for.{' '}
              {openBoxesTotal} box{openBoxesTotal !== 1 ? 'es' : ''} still available for new participants.
            </div>
          )}
        </div>
      )}

      {/* Fallback: progress only (no surface/layer detail yet) */}
      {!hasSurfaces && hasItems && (
        <div className="group-order-layer-card">
          <div className="group-order-layer-title">
            {isImportOrder ? 'Products on surface' : 'Products added'}
          </div>
          <div className="group-order-moq-info">
            Surface{groupOrder.moqSurfaces > 1 ? 's' : ''} to ship: <strong>{groupOrder.moqSurfaces}</strong>
          </div>
          <div className="group-order-layer-list">
            {groupOrder.progress?.productLayers.map((layer, idx) => (
              <div className="group-order-layer-item" key={layer.productId}>
                <div className="group-order-layer-product-name">
                  {layer.productId}
                </div>
                <div className="group-order-layer-stats">
                  {layer.quantity} units ({Math.ceil(layer.quantity / (layer.boxesPerLayer || 1))} box{Math.ceil(layer.quantity / (layer.boxesPerLayer || 1)) !== 1 ? 'es' : ''})
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
