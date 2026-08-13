import type { ReactNode } from "react";

/**
 * Renders content that is programmatically present (readable by assistive
 * technology and reachable via `document.activeElement`) but not visually
 * rendered. No fixed pixel positioning — the standard clip technique below
 * uses only absolute positioning and overflow, so it never contributes to
 * the narrow-viewport horizontal-scroll requirement.
 */
export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return (
    <span
      style={{
        position: "absolute",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
