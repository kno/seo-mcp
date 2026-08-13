import { useId, useState } from "react";
import type { FormEvent } from "react";

type LoginStatus =
  | { readonly phase: "idle" }
  | { readonly phase: "submitting" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "success" };

/**
 * The dashboard's only entry point for `POST /auth/session` — the login
 * route itself, so unlike every other request in this app it is NOT gated
 * by `authenticate()` and does not go through `requestTool` (this is not
 * an MCP tool call; it spends no part of the shared rate-limit bucket).
 * Presented as a small, always-visible panel in the app shell rather than
 * a full-screen gate: there is no cheap "am I already authenticated?"
 * endpoint to check on mount, so a returning visitor with a still-valid
 * session cookie is never blocked from using the nav while this sits
 * quietly in the rail — they simply never need to submit it.
 */
export function LoginContainer() {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<LoginStatus>({ phase: "idle" });
  const fieldId = useId();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ phase: "submitting" });

    let response: Response;
    try {
      response = await fetch("/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret }),
      });
    } catch {
      setStatus({
        phase: "error",
        message: "Could not reach the dashboard. Check your connection.",
      });
      return;
    }

    if (response.status === 204) {
      setSecret("");
      setStatus({ phase: "success" });
      return;
    }

    setStatus({
      phase: "error",
      message:
        response.status === 401
          ? "Incorrect secret."
          : response.status === 400
            ? "Enter your access secret."
            : "The access gate is temporarily unavailable.",
    });
  }

  if (status.phase === "success") {
    return (
      <p className="session-status" data-testid="session-status">
        Signed in.
      </p>
    );
  }

  return (
    <form className="session-form" onSubmit={handleSubmit}>
      <label htmlFor={fieldId}>Access secret</label>
      <input
        id={fieldId}
        name="secret"
        type="password"
        autoComplete="off"
        value={secret}
        onChange={(event) => setSecret(event.target.value)}
        required
      />
      <button
        className="session-submit"
        type="submit"
        disabled={status.phase === "submitting"}
      >
        {status.phase === "submitting" ? "Signing in…" : "Sign in"}
      </button>
      {status.phase === "error" && (
        <p className="session-error" role="alert">
          {status.message}
        </p>
      )}
    </form>
  );
}
