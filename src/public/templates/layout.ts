import { STYLES } from './_styles';

/**
 * Safe escape function for HTML context (text between tags / attributes).
 * Never renders raw user input.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Safe JSON embedding in <script> tag — prevents `</script>` injection.
 */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export type LayoutOpts = {
  title: string;
  bodyHtml: string;
  inlineScript?: string;
};

/**
 * Base HTML layout — used for all public pages (form, thank you, closed).
 *
 * Design:
 *   - Mobile-first viewport
 *   - Inline CSS (one network round trip)
 *   - No external fonts / CDN (privacy + performance)
 *   - X-Content-Type-Options, X-Frame-Options set by Nest globally (TODO)
 */
export function layout({ title, bodyHtml, inlineScript }: LayoutOpts): string {
  return `<!doctype html>
<html lang="sr-Latn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <main class="page">
    ${bodyHtml}
  </main>
  ${inlineScript ? `<script>${inlineScript}</script>` : ''}
</body>
</html>`;
}
