"use client";

interface Props {
  suggestions: string[];
  onAction: (text: string) => void;
}

export default function QuickActions({ suggestions, onAction }: Props) {
  if (suggestions.length === 0) return null;

  return (
    <div className="quick-actions">
      {suggestions.map((s) => (
        <button
          key={s}
          className="quick-action-chip"
          onClick={() => onAction(s)}
          type="button"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
