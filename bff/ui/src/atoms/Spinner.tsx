/**
 * Purely decorative loading indicator. Carries no accessible name of its
 * own (`aria-hidden`) — the enclosing `role="status"` text is the single
 * channel that announces "loading" to assistive technology, per
 * `dashboard-shell`'s "loading is distinct" requirement.
 */
export function Spinner() {
  return <span aria-hidden="true" data-testid="spinner" />;
}
