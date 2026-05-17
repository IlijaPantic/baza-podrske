import { adminLayout, escapeHtml } from '../../auth/templates/admin-layout';
import type { AuditListFilters, AuditRow } from '../../audit/audit.service';
import { AUDIT_EVENT_VALUES } from '../../audit/audit.events';

const DATE_FMT = new Intl.DateTimeFormat('sr-Latn-RS', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function fmt(d: Date): string {
  return DATE_FMT.format(d);
}

/**
 * Color classification by event type.
 * - success: green (LOGIN_OK, SURVEY_OPENED, SUBMIT_OK, ADMIN_CREATED, REACTIVATED)
 * - warning: yellow (LOGIN_LOCKED, RATE_LIMITED, DEACTIVATED, SESSIONS_REVOKED, SURVEY_CLOSED, DUPLICATE)
 * - error: red (LOGIN_FAIL, CSRF_FAIL, SUBMIT_VALIDATION)
 * - info: gray (LOGOUT, SESSION_EXPIRED, BOT, PASSWORD_RESET, SUBMIT_SURVEY_CLOSED)
 */
function eventClass(event: string): string {
  if (
    event === 'LOGIN_OK' ||
    event === 'SURVEY_OPENED' ||
    event === 'SUBMIT_OK' ||
    event === 'ADMIN_CREATED' ||
    event === 'ADMIN_REACTIVATED'
  )
    return 'success';
  if (
    event === 'LOGIN_LOCKED' ||
    event === 'LOGIN_RATE_LIMITED' ||
    event === 'SUBMIT_RATE_LIMITED' ||
    event === 'ADMIN_DEACTIVATED' ||
    event === 'ADMIN_SESSIONS_REVOKED' ||
    event === 'SURVEY_CLOSED' ||
    event === 'SUBMIT_DUPLICATE'
  )
    return 'warning';
  if (
    event === 'LOGIN_FAIL' ||
    event === 'CSRF_FAIL' ||
    event === 'SUBMIT_VALIDATION'
  )
    return 'error';
  return 'info';
}

function filtersToQuery(filters: AuditListFilters, extra: Record<string, string | number> = {}): string {
  const parts: string[] = [];
  if (filters.event) parts.push(`event=${encodeURIComponent(filters.event)}`);
  if (filters.userId) parts.push(`userId=${encodeURIComponent(filters.userId)}`);
  if (filters.targetUserId) parts.push(`targetUserId=${encodeURIComponent(filters.targetUserId)}`);
  if (filters.od) parts.push(`od=${encodeURIComponent(filters.od)}`);
  if (filters.do) parts.push(`do=${encodeURIComponent(filters.do)}`);
  for (const [k, v] of Object.entries(extra)) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

export type AuditPageOpts = {
  userEmail: string;
  filters: AuditListFilters;
  rows: AuditRow[];
  total: number;
  page: number;
  totalPages: number;
};

function paginationHtml(opts: AuditPageOpts): string {
  if (opts.totalPages <= 1) return '';
  const buildLink = (page: number, label?: string, current = false, disabled = false): string => {
    const text = label ?? String(page);
    if (disabled) return `<span class="disabled">${escapeHtml(text)}</span>`;
    if (current) return `<span class="current">${escapeHtml(text)}</span>`;
    const q = filtersToQuery(opts.filters, { page });
    return `<a href="?${q}">${escapeHtml(text)}</a>`;
  };
  const items: string[] = [];
  items.push(buildLink(1, '«', false, opts.page === 1));
  items.push(buildLink(opts.page - 1, '‹', false, opts.page === 1));
  const window = 2;
  const minP = Math.max(1, opts.page - window);
  const maxP = Math.min(opts.totalPages, opts.page + window);
  if (minP > 1) {
    items.push(buildLink(1, '1'));
    if (minP > 2) items.push(`<span class="disabled">…</span>`);
  }
  for (let p = minP; p <= maxP; p++) {
    items.push(buildLink(p, String(p), p === opts.page));
  }
  if (maxP < opts.totalPages) {
    if (maxP < opts.totalPages - 1) items.push(`<span class="disabled">…</span>`);
    items.push(buildLink(opts.totalPages, String(opts.totalPages)));
  }
  items.push(buildLink(opts.page + 1, '›', false, opts.page === opts.totalPages));
  items.push(buildLink(opts.totalPages, '»', false, opts.page === opts.totalPages));
  return `<div class="pagination">${items.join('')}</div>`;
}

export function adminAuditPage(opts: AuditPageOpts): string {
  const filtersHtml = `
    <form class="filters audit-filters" method="GET" action="/kontrola-admin/audit">
      <div class="field">
        <label for="event">Tip događaja</label>
        <select id="event" name="event">
          <option value="">— svi —</option>
          ${AUDIT_EVENT_VALUES
            .map(
              (e) =>
                `<option value="${escapeHtml(e)}"${opts.filters.event === e ? ' selected' : ''}>${escapeHtml(e)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div class="field">
        <label for="userId">User ID (ko)</label>
        <input id="userId" name="userId" type="text" value="${escapeHtml(opts.filters.userId ?? '')}" placeholder="UUID" />
      </div>
      <div class="field">
        <label for="targetUserId">Target ID (na koga)</label>
        <input id="targetUserId" name="targetUserId" type="text" value="${escapeHtml(opts.filters.targetUserId ?? '')}" placeholder="UUID" />
      </div>
      <div class="field">
        <label for="od">Od</label>
        <input id="od" name="od" type="date" value="${escapeHtml(opts.filters.od ?? '')}" />
      </div>
      <div class="field">
        <label for="do">Do</label>
        <input id="do" name="do" type="date" value="${escapeHtml(opts.filters.do ?? '')}" />
      </div>
      <div class="actions">
        <button type="submit">Filtriraj</button>
        <a class="btn" href="/kontrola-admin/audit">Poništi</a>
      </div>
    </form>
  `;

  const summary = `
    <div class="summary">
      <div>Ukupno: <strong>${opts.total}</strong> događaja${
        opts.filters.event || opts.filters.userId || opts.filters.targetUserId || opts.filters.od || opts.filters.do
          ? ' (sa filterima)'
          : ''
      }</div>
    </div>
  `;

  const tableHtml =
    opts.rows.length === 0
      ? `<div class="empty">Nema događaja sa zadatim filterima.</div>`
      : `
        <div class="table-wrap">
          <table class="list audit-table">
            <thead>
              <tr>
                <th>Vreme</th>
                <th>Događaj</th>
                <th>Ko</th>
                <th>Na koga</th>
                <th class="wrap">Metadata</th>
              </tr>
            </thead>
            <tbody>
              ${opts.rows
                .map((r) => {
                  const userCell = r.userEmail
                    ? escapeHtml(r.userEmail)
                    : r.userId
                      ? `<span class="muted">${escapeHtml(r.userId.slice(0, 8))}…</span>`
                      : '<span class="muted">—</span>';
                  const targetCell = r.targetEmail
                    ? escapeHtml(r.targetEmail)
                    : r.targetUserId
                      ? `<span class="muted">${escapeHtml(r.targetUserId.slice(0, 8))}…</span>`
                      : '<span class="muted">—</span>';
                  const metaJson =
                    r.metadata && Object.keys(r.metadata).length > 0
                      ? `<code>${escapeHtml(JSON.stringify(r.metadata))}</code>`
                      : '<span class="muted">—</span>';
                  return `
                <tr>
                  <td class="nowrap">${fmt(r.createdAt)}</td>
                  <td><span class="event-badge event-${eventClass(r.event)}">${escapeHtml(r.event)}</span></td>
                  <td>${userCell}</td>
                  <td>${targetCell}</td>
                  <td class="wrap meta-cell">${metaJson}</td>
                </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>`;

  const body = `
    <header class="header">
      <h1 style="font-size:22px;margin-bottom:4px">Audit log</h1>
      <p style="font-size:14px;color:var(--c-text-soft)">Sva sigurnosno-relevantna dejstva u sistemu.</p>
    </header>
    ${filtersHtml}
    ${summary}
    ${tableHtml}
    ${paginationHtml(opts)}
  `;

  return adminLayout({
    title: 'Audit log',
    bodyHtml: body,
    userEmail: opts.userEmail,
  });
}
