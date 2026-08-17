import { useEffect, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import {
  describeCredentialTier,
  describeHealthState,
  useSiteContext,
} from "../app/SiteContext";

/**
 * Domain-management follow-up. A simple table of the persisted `sites`
 * list, an add form (url + optional label), and a per-row delete using the
 * SAME two-click confirm pattern `SnapshotListPanel`/
 * `CrawlSnapshotListPanel` already establish — a first click arms the row
 * ("Delete" -> "Confirm delete?"), a second click on the SAME row deletes
 * it, and clicking a different row's button re-arms that row instead.
 * `pendingDeleteId` resets whenever `sites` changes, mirroring those two
 * panels' own reset-on-list-change behavior.
 *
 * `domain-google-credentials` Phase 6 adds a status column (tier + health,
 * as two distinct elements — task 6.1) and three per-row actions: Connect
 * (a plain navigation link to the BFF's OAuth authorize route, never a
 * fetch call), Disconnect (the SAME two-click confirm-gate pattern as
 * Delete, tracked by its own `pendingDisconnectId` so arming a disconnect
 * never also arms a delete on the same row or vice versa), and Recheck
 * (a single-click forced health probe — not destructive, no confirm gate).
 */
export function ManageDomainsContainer() {
  const {
    sites,
    addSite,
    deleteSite,
    disconnectSite,
    recheckSite,
    loading,
    error,
  } = useSiteContext();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [addInFlight, setAddInFlight] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [pendingDisconnectId, setPendingDisconnectId] = useState<number | null>(
    null,
  );
  const [recheckInFlightId, setRecheckInFlightId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    setPendingDeleteId(null);
    setPendingDisconnectId(null);
  }, [sites]);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addInFlight || url.trim() === "") return;
    setAddInFlight(true);
    setAddError(null);

    const result = await addSite(
      event,
      url.trim(),
      label.trim() === "" ? undefined : label.trim(),
    );
    setAddInFlight(false);

    if (!result.ok) {
      setAddError(
        result.error ? result.error.code : "That domain is already added.",
      );
      return;
    }
    setUrl("");
    setLabel("");
  }

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>, id: number) {
    if (pendingDeleteId === id) {
      setPendingDeleteId(null);
      void deleteSite(event, id);
    } else {
      setPendingDeleteId(id);
    }
  }

  function handleDisconnectClick(
    event: MouseEvent<HTMLButtonElement>,
    id: number,
  ) {
    if (pendingDisconnectId === id) {
      setPendingDisconnectId(null);
      void disconnectSite(event, id);
    } else {
      setPendingDisconnectId(id);
    }
  }

  async function handleRecheckClick(
    event: MouseEvent<HTMLButtonElement>,
    id: number,
  ) {
    setRecheckInFlightId(id);
    await recheckSite(event, id);
    setRecheckInFlightId(null);
  }

  return (
    <div className="view-stack">
      <form className="toolbar" onSubmit={handleAdd} aria-label="Add a domain">
        <div className="field-row">
          <div className="field">
            <label htmlFor="manage-domains-url">Domain URL</label>
            <input
              id="manage-domains-url"
              type="text"
              value={url}
              onChange={(event) => setUrl(event.currentTarget.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="manage-domains-label">Label (optional)</label>
            <input
              id="manage-domains-label"
              type="text"
              value={label}
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
          </div>
        </div>
        <div className="form-actions">
          <button
            className="btn-primary"
            type="submit"
            disabled={addInFlight || url.trim() === ""}
          >
            Add domain
          </button>
        </div>
      </form>

      {addError && (
        <div className="alert" role="alert" data-testid="add-site-error">
          {addError}
        </div>
      )}

      {error && (
        <div className="alert" role="alert" data-testid="list-sites-error">
          {error.code}
        </div>
      )}

      {loading ? (
        <p className="empty-state">Loading domains...</p>
      ) : sites.length === 0 ? (
        <p className="empty-state" data-testid="manage-domains-empty">
          No domains yet — add one above.
        </p>
      ) : (
        <div className="table-scroll">
          <table aria-label="Managed domains">
            <thead>
              <tr>
                <th scope="col">URL</th>
                <th scope="col">Label</th>
                <th scope="col">Added</th>
                <th scope="col">Connection</th>
                <th scope="col">Health</th>
                <th scope="col">Google account</th>
                <th scope="col">Recheck</th>
                <th scope="col">Delete</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => {
                const tierLabel = describeCredentialTier(site.credential.tier);
                const healthLabel = describeHealthState(
                  site.credential.health.searchConsole,
                );
                return (
                  <tr key={site.id}>
                    <td>{site.url}</td>
                    <td>{site.label ?? "(no label)"}</td>
                    <td>{site.createdAt}</td>
                    <td>
                      <span
                        data-testid={`tier-${site.id}`}
                        aria-label={`Connection tier for ${site.url}: ${tierLabel}`}
                      >
                        {tierLabel}
                      </span>
                    </td>
                    <td>
                      <span
                        data-testid={`health-${site.id}`}
                        className={`health-badge health-${site.credential.health.searchConsole.state}`}
                        aria-label={`Search Console health for ${site.url}: ${healthLabel}`}
                      >
                        {healthLabel}
                      </span>
                    </td>
                    <td>
                      {site.credential.tier === "site" ? (
                        <button
                          type="button"
                          className={
                            pendingDisconnectId === site.id
                              ? "btn-primary"
                              : "btn-ghost"
                          }
                          aria-label={`Disconnect Google account for ${site.url}`}
                          onClick={(event) =>
                            handleDisconnectClick(event, site.id)
                          }
                        >
                          {pendingDisconnectId === site.id
                            ? "Confirm disconnect?"
                            : "Disconnect"}
                        </button>
                      ) : (
                        <a
                          className="btn-ghost"
                          href={`/auth/google/authorize?siteId=${site.id}`}
                          aria-label={`Connect Google account for ${site.url}`}
                        >
                          Connect
                        </a>
                      )}
                    </td>
                    <td>
                      {site.credential.tier === "none" ? (
                        <span className="empty-state">—</span>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost"
                          aria-label={`Recheck connection for ${site.url}`}
                          disabled={recheckInFlightId === site.id}
                          onClick={(event) =>
                            void handleRecheckClick(event, site.id)
                          }
                        >
                          Recheck
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={
                          pendingDeleteId === site.id
                            ? "btn-primary"
                            : "btn-ghost"
                        }
                        aria-label={`Delete ${site.url}`}
                        onClick={(event) => handleDeleteClick(event, site.id)}
                      >
                        {pendingDeleteId === site.id
                          ? "Confirm delete?"
                          : "Delete"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
