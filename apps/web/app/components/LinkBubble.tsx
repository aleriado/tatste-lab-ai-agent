"use client";

import type { CheckoutLink } from "@taste-labs/shared";
import type { UiText } from "../page";

interface Props {
  link: CheckoutLink;
  t: UiText;
}

export default function LinkBubble({ link, t }: Props) {
  return (
    <div className="link-bubble">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="link-bubble-btn"
      >
        {t.completePayment}
      </a>
      {link.amountDueNow && (
        <div className="link-bubble-split">
          <span>{t.dueNow}: ₪{link.amountDueNow}</span>
          {link.amountDueLater && <span>{t.dueLater}: ₪{link.amountDueLater}</span>}
        </div>
      )}
    </div>
  );
}
