import { useEffect, useState } from "react";
import { PageReportContainer } from "../containers/PageReportContainer";
import { SiteCrawlContainer } from "../containers/SiteCrawlContainer";
import { PageSpeedContainer } from "../containers/PageSpeedContainer";
import { SearchConsoleContainer } from "../containers/SearchConsoleContainer";
import { GscInsightsContainer } from "../containers/GscInsightsContainer";
import { LoginContainer } from "../containers/LoginContainer";

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
  {
    href: "#page-report",
    label: "Page Report",
    // `description` is presentation only — it names what the view does in
    // the view header, so a landing user is not staring at a bare form.
    description:
      "Crawl a single URL and inspect its on-page metadata, heading structure, structured data and detected issues.",
    View: PageReportContainer,
  },
  {
    href: "#site-crawl",
    label: "Site Crawl",
    description:
      "Crawl a bounded set of pages across one domain: duplicate metadata, crawl policy, the internal link graph and per-page results.",
    View: SiteCrawlContainer,
  },
  {
    href: "#pagespeed",
    label: "PageSpeed",
    description:
      "Lighthouse category scores, lab metrics, real-user field data and the optimization opportunities reported for a URL.",
    View: PageSpeedContainer,
  },
  {
    href: "#search-console",
    label: "Search Console",
    description:
      "Query Google Search Console performance data for a property: clicks, impressions, CTR and position by query, page, country, device, date or search appearance.",
    View: SearchConsoleContainer,
  },
  {
    href: "#search-console-insights",
    label: "Search Console Insights",
    description:
      "Striking-distance keywords, low-CTR opportunities, and stored-snapshot comparison for a Search Console property — one shared property/date selector across all three.",
    View: GscInsightsContainer,
  },
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
    <div className="app-shell">
      {/* One `<header>` / one `<nav>` for every viewport — the rail on wide
          screens and the top bar on narrow ones are the same element
          relaid-out in CSS, never two duplicated navigation landmarks. */}
      <header className="app-rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            {/* Sized in `rem` from CSS (`.brand-mark svg`), never a fixed
                pixel width — the narrow-viewport requirement applies to
                decoration too. */}
            <svg viewBox="0 0 24 24" fill="none">
              <circle
                cx="10.5"
                cy="10.5"
                r="6.5"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="m15.5 15.5 4.5 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M8 11.5 10 9l2 2.5L14 7"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="brand-text">
            <h1 className="brand-title">SEO Dashboard</h1>
            <p className="brand-subtitle">Site intelligence</p>
          </div>
        </div>

        <nav aria-label="Primary">
          <p className="nav-label">Views</p>
          <ul className="nav-list">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a
                  className="nav-link"
                  href={item.href}
                  aria-current={item.href === hash ? "page" : undefined}
                >
                  <span className="nav-dot" aria-hidden="true" />
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section className="session-panel" aria-label="Session">
          <p className="session-panel-label">Session</p>
          <LoginContainer />
        </section>

        <p className="rail-footer">
          Every request is triggered by an explicit action. Nothing on this page
          polls, auto-refreshes, or refetches on focus.
        </p>
      </header>

      <main className="app-main" id="main-content">
        <div className="view-header">
          <p className="view-eyebrow">
            {active ? "Analysis" : "Getting started"}
          </p>
          <h2 className="view-title">{active ? active.label : "Overview"}</h2>
          <p className="view-description">
            {active
              ? active.description
              : "Pick a view from the navigation to run an analysis."}
          </p>
        </div>

        <div className="view-body">
          {ActiveView ? (
            <ActiveView />
          ) : (
            <div className="welcome">
              <p className="empty-state">Select a view above to get started.</p>
              <ul className="welcome-list">
                {NAV_ITEMS.map((item) => (
                  <li key={item.href}>
                    <a className="welcome-card" href={item.href}>
                      <span className="welcome-card-title">{item.label}</span>
                      <span className="welcome-card-body">
                        {item.description}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
