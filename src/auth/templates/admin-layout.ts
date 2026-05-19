import { STYLES } from '../../public/templates/_styles';
import { escapeHtml } from '../../public/templates/layout';
import { ADMIN_TABLE_STYLES } from '../../admin/templates/_table-styles';

export { escapeHtml };

/**
 * Additional admin styles (on top of base styles from /public).
 */
const ADMIN_STYLES = /* css */ `
  .admin-shell {
    max-width: 1180px;
    margin: 0 auto;
    padding: 12px 16px 64px;
  }
  @media (min-width: 640px) {
    .admin-shell { padding: 20px 24px 72px; }
  }

  .admin-topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 18px;
    background: var(--c-primary);
    color: #fff;
    border-radius: var(--radius-md);
    margin-bottom: 24px;
    font-size: 14px;
    flex-wrap: wrap;
    gap: 12px;
    box-shadow: 0 2px 8px rgba(124, 29, 29, 0.18);
  }
  .admin-topbar .topbar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .admin-topbar .topbar-brand {
    display: inline-flex;
    align-items: center;
    font-weight: 800;
    font-size: 18px;
    letter-spacing: 0.02em;
    color: #fff;
    text-decoration: none;
    padding: 4px 10px;
    margin: -4px -4px -4px -10px;
    border-radius: 6px;
    transition: background-color 0.12s ease;
  }
  .admin-topbar .topbar-brand:hover,
  .admin-topbar .topbar-brand:focus-visible {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    text-decoration: none;
  }
  .admin-topbar .topbar-brand:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
  .admin-topbar .topbar-email {
    color: rgba(255, 255, 255, 0.72);
    font-size: 13px;
  }
  .admin-topbar .topbar-region {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.18);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .admin-topbar .topbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .admin-topbar .topbar-right a,
  .admin-topbar .topbar-right button.link {
    color: rgba(255, 255, 255, 0.85);
    text-decoration: none;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: inherit;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .admin-topbar .topbar-right a:hover,
  .admin-topbar .topbar-right button.link:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }
  .admin-topbar .topbar-right form { display: inline; }

  @media (max-width: 540px) {
    .admin-topbar { padding: 12px 14px; }
    .admin-topbar .topbar-email { display: none; }
    .admin-topbar .topbar-right a,
    .admin-topbar .topbar-right button.link {
      padding: 6px 8px;
      font-size: 13px;
    }
  }

  .login-shell {
    max-width: 420px;
    margin: 48px auto 0;
    padding: 0 16px;
  }
  @media (min-width: 640px) {
    .login-shell { margin-top: 80px; }
  }

  /* Helper for null/empty cells */
  .muted { color: var(--c-text-muted); }
`;

export type AdminLayoutOpts = {
  title: string;
  bodyHtml: string;
  /** Active user email for topbar. If missing (login page) — topbar is not rendered. */
  userEmail?: string;
  /** Name of the admin's control region (e.g. "Univerzitet u Novom Sadu"). */
  controlRegionName?: string;
  /** Whether to add CSP allowing inline <script>. Login has no JS; dashboard enables where needed. */
  allowInlineScript?: boolean;
  inlineScript?: string;
};

/**
 * Base HTML layout for admin.
 *
 * Differences vs public layout:
 *  - strict CSP header (allow self + inline style only)
 *  - noindex meta tag (already in public layout; duplicated here)
 *  - topbar with logout (when user is signed in)
 *  - inline script disabled by default (login only; dashboard opts in where needed)
 */
export function adminLayout(opts: AdminLayoutOpts): string {
  const topbar = opts.userEmail
    ? `
    <nav class="admin-topbar" aria-label="Admin navigacija">
      <div class="topbar-left">
        <a class="topbar-brand" href="/kontrola-admin" title="Početna — prijave">Kontrola</a>
        ${opts.controlRegionName ? `<span class="topbar-region" title="Univerzitet">${escapeHtml(opts.controlRegionName)}</span>` : ''}
        <span class="topbar-email">${escapeHtml(opts.userEmail)}</span>
      </div>
      <div class="topbar-right">
        <a href="/kontrola-admin/anketa">Anketa</a>
        <a href="/kontrola-admin/admini">Admini</a>
        <a href="/kontrola-admin/audit">Audit</a>
        <a href="/kontrola-admin/nalog">Nalog</a>
        <a href="/kontrola-admin/2fa">2FA</a>
        <form method="POST" action="/kontrola-admin/logout">
          <button type="submit" class="link">Odjavi me</button>
        </form>
      </div>
    </nav>`
    : '';

  return `<!doctype html>
<html lang="sr-Latn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(opts.title)} · Kontrola admin</title>
  <style>${STYLES}${ADMIN_STYLES}${ADMIN_TABLE_STYLES}</style>
</head>
<body>
  <main class="admin-shell">
    ${topbar}
    ${opts.bodyHtml}
  </main>
  ${opts.inlineScript ? `<script>${opts.inlineScript}</script>` : ''}
</body>
</html>`;
}
