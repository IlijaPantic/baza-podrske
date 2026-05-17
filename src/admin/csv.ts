/**
 * Minimal RFC 4180 CSV serializer.
 *
 * - Separator: comma
 * - Eol: \r\n (RFC default)
 * - Quoting: value is quoted if it contains a comma, quotes, or newline
 * - Quotes are escaped by doubling (" -> "")
 * - BOM (UTF-8) at the start so Excel recognizes Cyrillic/diacritics correctly
 */

const EOL = '\r\n';
const BOM = '\uFEFF';

function escapeField(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) {
    s = v.toISOString();
  } else if (typeof v === 'string') {
    s = v;
  } else {
    s = String(v);
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

export function toCsv<T>(rows: Iterable<T>, columns: CsvColumn<T>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeField(c.header)).join(','));
  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(c.value(row))).join(','));
  }
  return BOM + lines.join(EOL) + EOL;
}
