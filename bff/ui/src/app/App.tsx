import { useEffect, useState } from "react";
import { PageReportContainer } from "../containers/PageReportContainer";
import { SiteCrawlContainer } from "../containers/SiteCrawlContainer";
import { PageSpeedContainer } from "../containers/PageSpeedContainer";

/**
 * Root shell: header, title, primary navigation, and a minimal hash router.
 * `broken-links-view` has no nav entry of its own — per its spec it is a
 * panel attached to an already-loaded page report, not a standalone route,
 * so `PageReportContainer` composes it directly rather than App routing to
 * it. No fixed pixel widths anywhere, per the narrow-viewport requirement;
 * layout uses only relative units (see
 * `openspec/changes/archive/2026-08-13-dashboard-views/apply-progress` for
 * the documented manual 360px/1440px check this honestly cannot automate
 * in jsdom).
 */
const NAV_ITEMS = [
  { href: "#page-report", label: "Page Report", View: PageReportContainer },
  { href: "#site-crawl", label: "Site Crawl", View: SiteCrawlContainer },
  { href: "#pagespeed", label: "PageSpeed", View: PageSpeedContainer },
] as const;

export function App() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const active = NAV_ITEMS.find((item) => item.href === hash);
  const ActiveView = active?.View;

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
        {ActiveView ? (
          <ActiveView />
        ) : (
          <p>Select a view above to get started.</p>
        )}
      </main>
    </div>
  );
}
