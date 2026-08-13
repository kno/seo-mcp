/**
 * `result-export`'s client-side download trigger, per `design.md`'s
 * "Export Implementation": `Blob` → `URL.createObjectURL` → anchor click →
 * `revokeObjectURL` in the same handler. A pure function of its props — the
 * JSON/CSV text is built upstream by the container (`export/json.ts` /
 * `export/csv.ts`) so this component never imports `data/client` or issues
 * any request; export never spends the shared rate-limit bucket and is
 * therefore never blocked by a bound (`result-export`'s "Export is never
 * blocked by a bound or truncation" requirement) — clicking either button
 * always succeeds regardless of what `provenance`/`bounds` the content
 * carries.
 */
export interface ExportMenuProps {
  readonly jsonContent: string;
  readonly csvContent: string;
  /** Used to name the downloaded file, without an extension. */
  readonly filenameBase: string;
}

function download(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ExportMenu({
  jsonContent,
  csvContent,
  filenameBase,
}: ExportMenuProps) {
  return (
    <div className="form-actions" role="group" aria-label="Export result">
      <button
        className="btn-sm"
        type="button"
        onClick={() =>
          download(jsonContent, "application/json", `${filenameBase}.json`)
        }
      >
        Export JSON
      </button>
      <button
        className="btn-sm"
        type="button"
        onClick={() => download(csvContent, "text/csv", `${filenameBase}.csv`)}
      >
        Export CSV
      </button>
    </div>
  );
}
