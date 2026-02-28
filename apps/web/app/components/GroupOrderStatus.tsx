"use client";

import type { GroupOrderSnapshot } from "@taste-labs/shared";
import type { UiText } from "../page";

interface Props {
  groupOrder: GroupOrderSnapshot;
  t: UiText;
}

export default function GroupOrderStatus({ groupOrder, t }: Props) {
  const progress = groupOrder.moqTarget > 0
    ? Math.min(100, Math.round((groupOrder.moqCurrent / groupOrder.moqTarget) * 100))
    : 0;
  const hasLayerProgress = !!groupOrder.progress && groupOrder.progress.productLayers.length > 0;

  return (
    <div className="group-order-status">
      <div className="group-order-header">
        <span className="group-order-label">{t.groupOrder}</span>
        <span className="group-order-code">{groupOrder.code}</span>
      </div>
      <div className="group-order-progress-bar">
        <div className="group-order-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="group-order-details">
        <span>{groupOrder.moqCurrent} / {groupOrder.moqTarget} {t.items}</span>
        <span>{groupOrder.participantCount} {t.participants}</span>
        <span className={`group-order-badge ${groupOrder.status.toLowerCase()}`}>
          {groupOrder.status}
        </span>
      </div>
      {groupOrder.manufacturerId && (
        <div className="group-order-meta-row">
          Manufacturer: <strong>{groupOrder.manufacturerId}</strong>
        </div>
      )}
      {groupOrder.progress && (
        <div className="group-order-meta-row">
          Remaining to MOQ: <strong>{groupOrder.progress.remainingToTarget}</strong> boxes
        </div>
      )}
      {hasLayerProgress && (
        <div className="group-order-layer-card">
          <div className="group-order-layer-title">Layer balancing progress</div>
          <div className="group-order-layer-summary">
            Balanced layers: <strong>{groupOrder.progress?.balancedLayers ?? 0}</strong>
            <span className="group-order-layer-dot">•</span>
            Total boxes: <strong>{groupOrder.progress?.totalBoxes ?? 0}</strong>
          </div>
          <div className="group-order-layer-list">
            {groupOrder.progress?.productLayers.map((layer) => (
              <div className="group-order-layer-item" key={layer.productId}>
                <span className="group-order-layer-product">{layer.productId}</span>
                <span className="group-order-layer-stats">
                  {layer.quantity} boxes
                  <span className="group-order-layer-dot">•</span>
                  {layer.completedLayers} completed
                  <span className="group-order-layer-dot">•</span>
                  {layer.openedLayers} opened
                  <span className="group-order-layer-dot">•</span>
                  {layer.boxesPerLayer}/layer
                </span>
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
    </div>
  );
}
