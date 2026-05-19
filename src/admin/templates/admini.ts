import { adminLayout, escapeHtml } from '../../auth/templates/admin-layout';
import type { AdminUserRow } from '../admin-users.service';

const DATE_FMT = new Intl.DateTimeFormat('sr-Latn-RS', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function fmtDate(d: Date | null): string {
  return d ? DATE_FMT.format(d) : '—';
}

export type AdminUsersPageOpts = {
  userEmail: string;
  controlRegionName: string;
  csrfToken: string;
  users: AdminUserRow[];
  message?: string;
  error?: string;
};

export function adminUsersPage(opts: AdminUsersPageOpts): string {
  const rows = opts.users
    .map((u) => {
      const stateBadge = u.deletedAt
        ? `<span class="state-badge state-inactive">Deaktiviran</span>`
        : `<span class="state-badge state-active">Aktivan</span>`;
      const locked =
        u.lockedUntil && u.lockedUntil > new Date()
          ? `<br><span class="muted" style="font-size:12px">Zaključan do ${fmtDate(u.lockedUntil)}</span>`
          : '';
      const failed =
        u.failedLoginCount > 0 && !u.deletedAt
          ? `<br><span class="muted" style="font-size:12px">Neuspešnih: ${u.failedLoginCount}</span>`
          : '';

      const actions: string[] = [];

      if (!u.deletedAt) {
        // Reset password — allowed for yourself too (alternative to "change password")
        actions.push(`
          <form method="POST" action="/kontrola-admin/admini/${escapeHtml(u.id)}/lozinka" class="inline-action" onsubmit="return promptPassword(this);">
            <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
            <input type="hidden" name="newPassword" value="" />
            <button type="submit" class="link-btn">Resetuj lozinku</button>
          </form>`);

        if (!u.isSelf) {
          actions.push(`
          <form method="POST" action="/kontrola-admin/admini/${escapeHtml(u.id)}/odjavi-sesije" class="inline-action" onsubmit="return confirm('Sigurno odjaviti sve sesije ovog admina?');">
            <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
            <button type="submit" class="link-btn">Odjavi sesije</button>
          </form>`);
          actions.push(`
          <form method="POST" action="/kontrola-admin/admini/${escapeHtml(u.id)}/deaktiviraj" class="inline-action" onsubmit="return confirm('Sigurno deaktivirati ovog admina? Sve njegove sesije biće odjavljene.');">
            <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
            <button type="submit" class="link-btn danger">Deaktiviraj</button>
          </form>`);
        }
      } else {
        actions.push(`
          <form method="POST" action="/kontrola-admin/admini/${escapeHtml(u.id)}/reaktiviraj" class="inline-action" onsubmit="return confirm('Sigurno reaktivirati ovog admina?');">
            <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
            <button type="submit" class="link-btn">Reaktiviraj</button>
          </form>`);
      }

      return `
        <tr class="${u.deletedAt ? 'deactivated' : ''}">
          <td class="name">
            ${escapeHtml(u.email)}
            ${u.isSelf ? '<span class="state-badge state-self">vi</span>' : ''}
          </td>
          <td>${stateBadge}${locked}${failed}</td>
          <td>${fmtDate(u.createdAt)}</td>
          <td>${fmtDate(u.lastLoginAt)}</td>
          <td>${u.activeSessions}</td>
          <td class="actions-cell">${actions.join('')}</td>
        </tr>`;
    })
    .join('');

  const tableHtml =
    opts.users.length === 0
      ? `<div class="empty">Nema admin korisnika.</div>`
      : `
        <div class="table-wrap">
          <table class="list">
            <thead>
              <tr>
                <th>Email</th>
                <th>Status</th>
                <th>Kreiran</th>
                <th>Poslednji login</th>
                <th>Aktivne sesije</th>
                <th>Akcije</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>`;

  const body = `
    <header class="header">
      <h1 style="font-size:22px;margin-bottom:4px">Admini</h1>
      <p style="font-size:14px;color:var(--c-text-soft)">Upravljanje pristupom za admin panel.</p>
    </header>

    ${opts.message ? `<div class="global-success">${escapeHtml(opts.message)}</div>` : ''}
    ${opts.error ? `<div class="global-error">${escapeHtml(opts.error)}</div>` : ''}

    <div class="card" style="margin-bottom:24px;padding-bottom:36px">
      <h2 style="margin:0 0 16px;font-size:16px;font-weight:600">Dodaj novog admina</h2>
      <form method="POST" action="/kontrola-admin/admini/novi" autocomplete="off">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <div class="filters" style="grid-template-columns:1fr 1fr auto;margin-bottom:0;padding:0;background:transparent;border:0">
          <div class="field">
            <label for="newEmail">Email</label>
            <input id="newEmail" name="email" type="email" required maxlength="254" autocomplete="off" autocapitalize="off" spellcheck="false" />
          </div>
          <div class="field has-hint">
            <label for="newPassword">Lozinka</label>
            <input id="newPassword" name="password" type="password" required minlength="12" maxlength="200" autocomplete="new-password" />
            <span class="hint">Min. 12 karaktera. Bezbedno prosledi novom adminu.</span>
          </div>
          <div class="actions">
            <button type="submit">Kreiraj admina</button>
          </div>
        </div>
      </form>
    </div>

    ${tableHtml}
  `;

  const inlineScript = `
    function promptPassword(form){
      var p = window.prompt('Unesi novu lozinku za ovog admina (min 12 karaktera). Sve njegove sesije biće odjavljene.');
      if (p == null) return false;
      if (p.length < 12) { alert('Lozinka mora imati minimum 12 karaktera.'); return false; }
      if (p.length > 200) { alert('Lozinka je preduga.'); return false; }
      form.elements['newPassword'].value = p;
      return confirm('Resetovati lozinku? Korisnik će biti odjavljen sa svih uređaja.');
    }
  `;

  return adminLayout({
    title: 'Admini',
    bodyHtml: body,
    userEmail: opts.userEmail,
    controlRegionName: opts.controlRegionName,
    inlineScript,
  });
}
