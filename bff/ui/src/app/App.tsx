/**
 * Root shell: header, title, and primary navigation. Views (page report,
 * broken links, site crawl, PageSpeed) ship starting in Phase 3 — this
 * component intentionally has no routing and no data fetching, only the
 * navigation skeleton every later view attaches to. No fixed pixel widths
 * anywhere, per the narrow-viewport requirement; layout uses only relative
 * units (see `openspec/changes/dashboard-views/apply-progress` for the
 * documented manual 360px/1440px check this honestly cannot automate in
 * jsdom).
 */
const NAV_ITEMS = [
  { href: "#page-report", label: "Page Report" },
  { href: "#site-crawl", label: "Site Crawl" },
  { href: "#broken-links", label: "Broken Links" },
  { href: "#pagespeed", label: "PageSpeed" },
] as const;

export function App() {
  return (
    <div>
      <header>
        <h1>SEO Dashboard</h1>
        <nav aria-label="Primary">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main-content">
        <p>Views ship in later phases of this change.</p>
      </main>
    </div>
  );
}
