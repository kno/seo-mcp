/**
 * SPA entry point. Phase 1 (dashboard-views) proved the build/asset-serving
 * wiring with a placeholder; Phase 2 replaces it with the real shell root
 * (`App`) — navigation and the state-contract primitives views attach to
 * starting in Phase 3.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
