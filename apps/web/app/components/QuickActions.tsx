"use client";

interface Props {
  suggestions: string[];
  onAction: (text: string) => void;
  disabled?: boolean;
}

export default function QuickActions({ suggestions, onAction, disabled }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <div className="quick-actions">
      {suggestions.map((s) => (
        <button
          key={s}
          className="quick-action-chip"
          onClick={() => onAction(s)}
          type="button"
          disabled={disabled}
        >
          {s.replace(/\s*\[productId:\d+\]/g, '')}
        </button>
      ))}
    </div>
  );
}
