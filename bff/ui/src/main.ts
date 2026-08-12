/**
 * Placeholder SPA entry point for dashboard-views Phase 1. Its only job is
 * to give the build/asset-serving wiring proven in this PR something real
 * to bundle and serve — the actual dashboard UI (navigation, views,
 * containers) ships starting in Phase 2 per `openspec/changes/dashboard-views`.
 */

const root = document.getElementById("root");
if (root) {
  root.textContent = "SEO Dashboard placeholder — views ship in later phases.";
}
