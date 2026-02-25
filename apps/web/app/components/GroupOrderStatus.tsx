"use client";

import type { GroupOrderSnapshot } from "@taste-labs/shared";

interface Props {
  groupOrder: GroupOrderSnapshot;
}

export default function GroupOrderStatus({ groupOrder }: Props) {
  const progress = groupOrder.moqTarget > 0
    ? Math.min(100, Math.round((groupOrder.moqCurrent / groupOrder.moqTarget) * 100))
    : 0;

  return (
    <div className="group-order-status">
      <div className="group-order-header">
        <span className="group-order-label">Group Order</span>
        <span className="group-order-code">{groupOrder.code}</span>
      </div>
      <div className="group-order-progress-bar">
        <div className="group-order-progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="group-order-details">
        <span>{groupOrder.moqCurrent} / {groupOrder.moqTarget} items</span>
        <span>{groupOrder.participantCount} participant{groupOrder.participantCount !== 1 ? "s" : ""}</span>
        <span className={`group-order-badge ${groupOrder.status.toLowerCase()}`}>
          {groupOrder.status}
        </span>
      </div>
      {groupOrder.expiresAt && (
        <div className="group-order-deadline">
          Expires: {new Date(groupOrder.expiresAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
