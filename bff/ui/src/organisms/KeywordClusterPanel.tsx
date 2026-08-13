/**
 * Renders a `ClusterResult` (`cluster_keywords`). `keyword-research-view`'s
 * "Clustering Is Inspectable, Not an Opaque Grouping" requirement (task 8.4):
 * every `KeywordCluster.keywords` member is listed directly, member-by-
 * member — no cluster ever collapses into a count-only summary. Each
 * classified keyword's `intent` is also surfaced independently of cluster
 * membership, per `ClassifiedKeyword { keyword, intent, tokens }`
 * (`src/seo/keywords.ts:18-21`).
 */
import type { ClusterResult } from "../../../../src/types";

export interface KeywordClusterPanelProps {
  readonly result: ClusterResult;
}

export function KeywordClusterPanel({ result }: KeywordClusterPanelProps) {
  if (result.count === 0) {
    return (
      <p className="empty-state" data-testid="keyword-cluster-empty-state">
        No clusters produced for this keyword list.
      </p>
    );
  }

  const intentEntries = Object.entries(result.intents);

  return (
    <div className="view-stack">
      <div className="panel panel-wide span-full">
        <h3>Intent summary</h3>
        <dl aria-label="Intent summary" data-testid="keyword-intent-summary">
          {intentEntries.map(([intent, count]) => (
            <div key={intent}>
              <dt>{intent}</dt>
              <dd>{count}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="panel panel-wide span-full">
        <h3>Clusters</h3>
        <ul
          className="keyword-cluster-list"
          aria-label="Clusters"
          data-testid="keyword-cluster-list"
        >
          {result.clusters.map((cluster) => (
            <li
              key={cluster.label}
              data-testid={`keyword-cluster-${cluster.label}`}
            >
              <h4>{cluster.label}</h4>
              {/* Every member listed directly — task 8.4: no cluster ever
                  collapses into a count-only summary. */}
              <ul aria-label={`Keywords in cluster ${cluster.label}`}>
                {cluster.keywords.map((keyword) => (
                  <li key={keyword}>{keyword}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel panel-wide span-full">
        <h3>Classified keywords</h3>
        <div className="table-scroll">
          <table aria-label="Classified keywords">
            <thead>
              <tr>
                <th scope="col">Keyword</th>
                <th scope="col">Intent</th>
                <th scope="col">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {result.keywords.map((classified) => (
                <tr key={classified.keyword}>
                  <td>{classified.keyword}</td>
                  <td>{classified.intent}</td>
                  <td>{classified.tokens.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
