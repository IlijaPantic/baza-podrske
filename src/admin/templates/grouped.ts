import { adminLayout, escapeHtml } from '../../auth/templates/admin-layout';
import type { ListFilters } from '../admin.service';

export type GroupedPageOpts = {
  userEmail: string;
  filters: ListFilters;
  groups: Array<{ slug: string; naziv: string; count: number }>;
};

export function adminGroupedPage(opts: GroupedPageOpts): string {
  const total = opts.groups.reduce((sum, g) => sum + g.count, 0);
  const filtersDesc: string[] = [];
  if (opts.filters.opstina) filtersDesc.push(`opština: ${opts.filters.opstina}`);
  if (opts.filters.od) filtersDesc.push(`od ${opts.filters.od}`);
  if (opts.filters.do) filtersDesc.push(`do ${opts.filters.do}`);

  const body = `
    <div class="card">
      <h2 style="margin-top:0">Prijave grupisane po opštini</h2>
      <p style="color:#59636e">
        Ukupno: <strong>${total}</strong> prijava u <strong>${opts.groups.length}</strong> opštin${
          opts.groups.length === 1 ? 'i' : 'a'
        }.
        ${filtersDesc.length > 0 ? `<br>Aktivni filteri: ${escapeHtml(filtersDesc.join(', '))}` : ''}
      </p>

      ${
        opts.groups.length === 0
          ? `<div class="empty">Nema prijava sa zadatim filterima.</div>`
          : `
      <table class="list" style="margin-top:16px">
        <thead>
          <tr>
            <th>Opština</th>
            <th style="text-align:right">Broj prijava</th>
            <th style="text-align:right">%</th>
          </tr>
        </thead>
        <tbody>
          ${opts.groups
            .map(
              (g) => `
          <tr>
            <td>
              <a href="/kontrola-admin?opstina=${encodeURIComponent(g.slug)}" style="color:#0969da;text-decoration:none">
                ${escapeHtml(g.naziv)}
              </a>
            </td>
            <td style="text-align:right"><strong>${g.count}</strong></td>
            <td style="text-align:right;color:#59636e">${total > 0 ? ((g.count / total) * 100).toFixed(1) : '0.0'}%</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
      }

      <p style="margin-top:16px"><a href="/kontrola-admin" style="color:#0969da;text-decoration:none">← Nazad na listu</a></p>
    </div>
  `;

  return adminLayout({
    title: 'Grupisano po opštini',
    bodyHtml: body,
    userEmail: opts.userEmail,
  });
}
