import { adminLayout, escapeHtml } from '../../auth/templates/admin-layout';

export type AnketaPageOpts = {
  userEmail: string;
  controlRegionName: string;
  isOpen: boolean;
  csrfToken: string;
  message?: string;
};

export function adminAnketaPage(opts: AnketaPageOpts): string {
  const statusClass = opts.isOpen ? 'open' : 'closed';
  const statusBadge = opts.isOpen ? '●' : '!';
  const statusTitle = opts.isOpen ? 'Anketa je otvorena' : 'Anketa je zatvorena';
  const statusDesc = opts.isOpen
    ? 'Javna forma trenutno prima nove prijave.'
    : 'Javna forma odbija nove prijave i prikazuje poruku "Anketa je zatvorena".';

  const action = opts.isOpen ? 'close' : 'open';
  const buttonLabel = opts.isOpen ? 'Zatvori anketu' : 'Otvori anketu';
  const buttonClass = opts.isOpen ? 'danger-btn' : 'success-btn';
  const confirmMsg = opts.isOpen
    ? 'Sigurno želiš da zatvoriš anketu? Nove prijave neće biti moguće dok je ne otvoriš ponovo.'
    : 'Sigurno želiš da otvoriš anketu?';

  const body = `
    <div class="card">
      <div class="anketa-hero">
        <div>
          <h2>Kontrola ankete</h2>
          <p>Otvaranje i zatvaranje prijema novih prijava.</p>
        </div>
      </div>

      ${opts.message ? `<div class="global-success">${escapeHtml(opts.message)}</div>` : ''}

      <div class="anketa-status ${statusClass}">
        <span class="badge" aria-hidden="true">${statusBadge}</span>
        <div>
          <strong>${escapeHtml(statusTitle)}</strong><br>
          <span style="opacity:0.85">${escapeHtml(statusDesc)}</span>
        </div>
      </div>

      <form method="POST" action="/kontrola-admin/anketa/toggle" onsubmit="return confirm('${escapeHtml(confirmMsg)}');" style="margin-top:8px">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <input type="hidden" name="action" value="${action}" />
        <button type="submit" class="${buttonClass}">${escapeHtml(buttonLabel)}</button>
      </form>

      <p style="margin-top:24px;color:var(--c-text-muted);font-size:13px;line-height:1.5">
        Zatvaranje ankete <strong>ne briše</strong> postojeće prijave — i dalje su dostupne za pregled, filter i eksport.
      </p>
    </div>
  `;

  return adminLayout({
    title: opts.isOpen ? 'Anketa (otvorena)' : 'Anketa (zatvorena)',
    bodyHtml: body,
    userEmail: opts.userEmail,
    controlRegionName: opts.controlRegionName,
  });
}
