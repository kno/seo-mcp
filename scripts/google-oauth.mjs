// One-time helper: run the Google OAuth consent for the single-tenant SEO MCP
// and print a refresh token. Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from
// .dev.vars (or the environment). This script stores NO secrets — copy the printed
// refresh token into .dev.vars (GOOGLE_REFRESH_TOKEN=) and run
// `wrangler secret put GOOGLE_REFRESH_TOKEN` for deployment.
//
// Requires an OAuth client of type "Desktop app" (Google allows loopback redirects
// on any port for those). Run: node scripts/google-oauth.mjs

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"];
const PORT = 5858;
const REDIRECT = `http://localhost:${PORT}`;

function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match && !env[match[1]]) env[match[1]] = match[2];
    }
  } catch {
    // no .dev.vars — fall back to process.env
  }
  return env;
}

const env = loadEnv();
const clientId = env.GOOGLE_CLIENT_ID;
const clientSecret = env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .dev.vars or environment.",
  );
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES.join(" "));
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end(`Auth error: ${error}. You can close this tab.`);
    console.error("Consent failed:", error);
    server.close();
    process.exit(1);
  }
  if (!code) {
    res.end("Waiting for authorization...");
    return;
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok) {
      res.end("Token exchange failed. Check the terminal.");
      console.error("Token exchange error:", data);
      server.close();
      process.exit(1);
    }
    res.end(
      "Success. The refresh token is printed in your terminal. You can close this tab.",
    );
    if (data.refresh_token) {
      console.log(
        "\n=== GOOGLE_REFRESH_TOKEN ===\n" +
          data.refresh_token +
          "\n============================\n",
      );
    } else {
      console.error(
        "No refresh_token returned. Revoke prior access at " +
          "https://myaccount.google.com/permissions and re-run " +
          "(the flow already sends prompt=consent + access_type=offline).",
      );
    }
    server.close();
    process.exit(0);
  } catch (exchangeError) {
    console.error(exchangeError);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(
    "Open this URL to authorize (scope: Search Console read-only):\n\n" +
      authUrl.toString() +
      "\n",
  );
  // Best-effort browser open on macOS; ignore if unavailable.
  spawn("open", [authUrl.toString()], { stdio: "ignore" }).on(
    "error",
    () => {},
  );
});
