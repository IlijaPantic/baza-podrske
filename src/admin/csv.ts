/**
 * Minimal RFC 4180 CSV serializer.
 *
 * - Separator: comma
 * - Eol: \r\n (RFC default)
 * - Quoting: value is quoted if it contains a comma, quotes, or newline
 * - Quotes are escaped by doubling (" -> "")
 * - BOM (UTF-8) at the start so Excel recognizes Cyrillic/diacritics correctly
 *
 * Excel-text columns (`excelText: true`):
 *   Wraps the value in `="..."` so Excel does NOT parse it as a number.
 *   Useful for phone numbers like "0657894561" where Excel would otherwise
 *   strip the leading zero. Excel renders the cell as plain text.
 *   Other CSV parsers (pandas, csv module) see the literal `="0657894561"`
 *   so we expose a parallel column `telefon_e164` for programmatic use.
 */

const EOL = '\r\n';
const BOM = '\uFEFF';

function escapeField(v: unknown, excelText = false): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) {
    s = v.toISOString();
  } else if (typeof v === 'string') {
    s = v;
  } else {
    s = String(v);
  }

  if (excelText) {
    // Excel formula form: ="value" — Excel keeps it as text.
    // Inner double quotes get escaped per RFC 4180.
    const inner = s.replace(/"/g, '""');
    return `"=""${inner}"""`;
  }

  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
  /**
   * When true, wraps the cell in `="..."` so Excel preserves the value as
   * text (e.g. phone numbers with leading zeros).
   */
  excelText?: boolean;
};

export function toCsv<T>(rows: Iterable<T>, columns: CsvColumn<T>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeField(c.header)).join(','));
  for (const row of rows) {
    lines.push(
      columns.map((c) => escapeField(c.value(row), c.excelText)).join(','),
    );
  }
  return BOM + lines.join(EOL) + EOL;
}
