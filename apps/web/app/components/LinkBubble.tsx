"use client";

import type { CheckoutLink } from "@taste-labs/shared";

interface Props {
  link: CheckoutLink;
}

export default function LinkBubble({ link }: Props) {
  return (
    <div className="link-bubble">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="link-bubble-btn"
      >
        {link.label}
      </a>
      {link.amountDueNow && (
        <div className="link-bubble-split">
          <span>Due now: ₪{link.amountDueNow}</span>
          {link.amountDueLater && <span>Due later: ₪{link.amountDueLater}</span>}
        </div>
      )}
    </div>
  );
}
