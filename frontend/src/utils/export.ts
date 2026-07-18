/**
 * Lightweight client-side export helpers (CSV/JSON) shared by list pages
 * (TestRun CRDs, Schedules, Audit Log, Guardian history) so every page
 * does not hand-roll its own Blob/anchor-download boilerplate.
 */

function triggerDownload(filename: string, content: string, mimeType: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function exportToJSON(filename: string, data: unknown): void {
  triggerDownload(filename.endsWith('.json') ? filename : `${filename}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exports an array of flat objects as CSV, using the keys of the first
 * row (or an explicit column list) as headers.
 */
export function exportToCSV<T extends Record<string, unknown>>(filename: string, rows: T[], columns?: (keyof T)[]): void {
  if (rows.length === 0) {
    triggerDownload(filename.endsWith('.csv') ? filename : `${filename}.csv`, '', 'text/csv');
    return;
  }
  const cols = columns || (Object.keys(rows[0]) as (keyof T)[]);
  const header = cols.map((c) => csvEscape(String(c))).join(',');
  const lines = rows.map((row) => cols.map((c) => csvEscape(row[c])).join(','));
  triggerDownload(filename.endsWith('.csv') ? filename : `${filename}.csv`, [header, ...lines].join('\n'), 'text/csv');
}
