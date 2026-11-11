"use client";

import { useId } from "react";

/**
 * Small "i" icon with a tooltip on hover and keyboard focus. Pass `id` and
 * reference it from the related field's aria-describedby so screen readers
 * read the hint with the field.
 */
export function InfoTip({ text, id }: { text: string; id?: string }) {
  const fallback = useId();
  const tipId = id ?? fallback;
  return (
    <span className="info-tip">
      <button type="button" className="info-tip-icon" aria-label="More information" aria-describedby={tipId}>
        i
      </button>
      <span role="tooltip" id={tipId} className="info-tip-text">
        {text}
      </span>
    </span>
  );
}
