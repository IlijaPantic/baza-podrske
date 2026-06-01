import { adminLayout, escapeHtml } from '../../auth/templates/admin-layout';
import type { ListFilters, RegistrationRow } from '../admin.service';
import type { OpstinaListItem } from '../../polling-stations/polling-stations.service';

const DATE_FMT = new Intl.DateTimeFormat('sr-Latn-RS', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(d: Date): string {
  return DATE_FMT.format(d);
}

/**
 * Turns the filter object into "&opstina=…&od=…&do=…" (no leading ?).
 * Useful for pagination and export links.
 */
function filtersToQuery(filters: ListFilters, extra: Record<string, string | number> = {}): string {
  const parts: string[] = [];
  if (filters.opstina) parts.push(`opstina=${encodeURIComponent(filters.opstina)}`);
  if (filters.od) parts.push(`od=${encodeURIComponent(filters.od)}`);
  if (filters.do) parts.push(`do=${encodeURIComponent(filters.do)}`);
  for (const [k, v] of Object.entries(extra)) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

export type ListPageOpts = {
  userEmail: string;
  controlRegionName: string;
  /** Role of the active user — controls layout (nav) and filter UI. */
  role: 'admin' | 'municipality_admin';
  /** Opština name (pretty) for the municipality admin badge. */
  assignedOpstinaNaziv: string | null;
  filters: ListFilters;
  opstine: OpstinaListItem[];
  rows: RegistrationRow[];
  total: number;
  page: number;
  totalPages: number;
};

function paginationHtml(opts: ListPageOpts): string {
  if (opts.totalPages <= 1) return '';
  const buildLink = (page: number, label?: string, current = false, disabled = false): string => {
    const text = label ?? String(page);
    if (disabled) {
      return `<span class="disabled">${escapeHtml(text)}</span>`;
    }
    if (current) {
      return `<span class="current">${escapeHtml(text)}</span>`;
    }
    const q = filtersToQuery(opts.filters, { page });
    return `<a href="?${q}">${escapeHtml(text)}</a>`;
  };

  const items: string[] = [];
  items.push(buildLink(1, '«', false, opts.page === 1));
  items.push(buildLink(opts.page - 1, '‹', false, opts.page === 1));

  // Window: 2 around current + first + last, with "…" for skips
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

export function adminListPage(opts: ListPageOpts): string {
  const isMuni = opts.role === 'municipality_admin';
  const exportQuery = filtersToQuery(opts.filters);
  const exportSuffix = exportQuery ? `?${exportQuery}` : '';

  // Municipality admin: opština dropdown is single-option and disabled
  // (server-side scope already restricts to that opština — this is just UX
  // so the admin sees clearly that they cannot switch).
  const opstinaFieldHtml = isMuni
    ? `
      <div class="field">
        <label for="opstina">Opština</label>
        <select id="opstina" name="opstina" disabled aria-disabled="true">
          ${opts.opstine
            .map(
              (o) =>
                `<option value="${escapeHtml(o.slug)}" selected>${escapeHtml(o.naziv)}</option>`,
            )
            .join('')}
        </select>
      </div>`
    : `
      <div class="field">
        <label for="opstina">Opština</label>
        <select id="opstina" name="opstina">
          <option value="">— sve opštine —</option>
          ${opts.opstine
            .map(
              (o) =>
                `<option value="${escapeHtml(o.slug)}"${opts.filters.opstina === o.slug ? ' selected' : ''}>${escapeHtml(o.naziv)}</option>`,
            )
            .join('')}
        </select>
      </div>`;

  const filtersHtml = `
    <form class="filters" method="GET" action="/kontrola-admin">
      ${opstinaFieldHtml}
      <div class="field">
        <label for="od">Od datuma</label>
        <input id="od" name="od" type="date" value="${escapeHtml(opts.filters.od ?? '')}" />
      </div>
      <div class="field">
        <label for="do">Do datuma</label>
        <input id="do" name="do" type="date" value="${escapeHtml(opts.filters.do ?? '')}" />
      </div>
      <div class="actions">
        <button type="submit">Filtriraj</button>
        <a class="btn" href="/kontrola-admin">Poništi</a>
      </div>
    </form>
  `;

  // Municipality admin: NO "Grupisano" link (CR-only feature).
  const groupedLinkHtml = isMuni
    ? ''
    : `<a href="/kontrola-admin/grupisano${exportSuffix}">Grupisano po opštini</a>`;

  const summaryHtml = `
    <div class="summary">
      <div>Ukupno: <strong>${opts.total}</strong> prijava${opts.filters.opstina || opts.filters.od || opts.filters.do || isMuni ? ' (u vašem opsegu)' : ''}</div>
      <div class="export-links">
        ${groupedLinkHtml}
        <a href="/kontrola-admin/export.csv${exportSuffix}">CSV</a>
        <a href="/kontrola-admin/export.json${exportSuffix}">JSON</a>
      </div>
    </div>
  `;

  const tableHtml =
    opts.rows.length === 0
      ? `<div class="empty">Nema prijava sa zadatim filterima.</div>`
      : `
    <div class="table-wrap">
      <table class="list">
        <thead>
          <tr>
            <th>ID</th>
            <th>Ime i prezime</th>
            <th>God.</th>
            <th>Opština</th>
            <th class="wrap">Biračko mesto</th>
            <th>Telefon</th>
            <th class="wrap">Email</th>
            <th>Vreme</th>
          </tr>
        </thead>
        <tbody>
          ${opts.rows
            .map((r) => {
              const bm =
                r.bmBroj != null
                  ? `${r.bmBroj}${r.bmNaziv ? ` — ${escapeHtml(r.bmNaziv)}` : ''}`
                  : '<span class="muted">—</span>';
              return `
          <tr>
            <td class="short-code">${escapeHtml(r.shortId)}</td>
            <td class="name">${escapeHtml(r.firstName)} ${escapeHtml(r.lastName)}</td>
            <td>${r.birthYear ?? '<span class="muted">—</span>'}</td>
            <td>${escapeHtml(r.opstina)}</td>
            <td class="wrap">${bm}</td>
            <td>${escapeHtml(r.phone)}</td>
            <td class="wrap">${escapeHtml(r.email)}</td>
            <td>${formatDate(r.submittedAt)}</td>
          </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
  `;

  const body = `
    ${filtersHtml}
    ${summaryHtml}
    ${tableHtml}
    ${paginationHtml(opts)}
  `;

  return adminLayout({
    title: 'Prijave',
    bodyHtml: body,
    userEmail: opts.userEmail,
    controlRegionName: opts.controlRegionName,
    role: opts.role,
    opstinaNaziv: opts.assignedOpstinaNaziv,
  });
}
