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
      {groupOrder.expiresAt && (
        <div className="group-order-deadline">
          {t.expires}: {new Date(groupOrder.expiresAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
