import { adminLayout, escapeHtml } from '../../auth/templates/admin-layout';

export type NalogPageOpts = {
  userEmail: string;
  controlRegionName: string;
  csrfToken: string;
  /** Flash success message (from query ?m=changed). */
  message?: string;
  /** Validation/server error to display above the form. */
  error?: string;
  /** When set, marks a specific field as having a problem. */
  errorField?: 'currentPassword' | 'newPassword' | 'newPasswordConfirm';
};

/**
 * Self-service account page — for now: change own password.
 * Layout pattern mirrors `security.ts` (the 2FA page) so the admin gets a
 * consistent feel when managing their own account.
 */
export function nalogPage(opts: NalogPageOpts): string {
  const bodyHtml = `
    <header class="header" style="margin-top:8px;margin-bottom:18px">
      <h1 style="margin:0 0 4px;font-size:20px">Moj nalog</h1>
      <p style="font-size:14px;color:var(--c-text-soft);margin:0">
        Promena lozinke. Email naloga: <strong>${escapeHtml(opts.userEmail)}</strong>
      </p>
    </header>

    ${opts.message ? `<div class="global-success">${escapeHtml(opts.message)}</div>` : ''}
    ${opts.error ? `<div class="global-error">${escapeHtml(opts.error)}</div>` : ''}

    <div class="card" style="margin-top:16px">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:600">Promena lozinke</h2>
      <p style="margin:0 0 16px;color:var(--c-text-soft);font-size:14px;line-height:1.5">
        Nakon uspešne promene, sve ostale aktivne sesije ovog naloga biće odjavljene
        (drugi uređaji moraju ponovo da se uloguju). Trenutna sesija ostaje aktivna.
      </p>

      <form method="POST" action="/kontrola-admin/nalog/lozinka" autocomplete="off">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />

        <div class="field">
          <label for="currentPassword">Trenutna lozinka</label>
          <input id="currentPassword" name="currentPassword" type="password"
            required minlength="1" maxlength="200"
            autocomplete="current-password" />
          ${opts.errorField === 'currentPassword' ? `<span class="error">${escapeHtml(opts.error ?? '')}</span>` : ''}
        </div>

        <div class="field">
          <label for="newPassword">Nova lozinka</label>
          <input id="newPassword" name="newPassword" type="password"
            required minlength="12" maxlength="200"
            autocomplete="new-password" />
          <span class="hint">Minimum 12 karaktera. Predlažemo passphrase od 4–5 reči.</span>
          ${opts.errorField === 'newPassword' ? `<span class="error">${escapeHtml(opts.error ?? '')}</span>` : ''}
        </div>

        <div class="field">
          <label for="newPasswordConfirm">Potvrdi novu lozinku</label>
          <input id="newPasswordConfirm" name="newPasswordConfirm" type="password"
            required minlength="12" maxlength="200"
            autocomplete="new-password" />
          ${opts.errorField === 'newPasswordConfirm' ? `<span class="error">${escapeHtml(opts.error ?? '')}</span>` : ''}
        </div>

        <button type="submit">Promeni lozinku</button>
      </form>
    </div>
  `;

  return adminLayout({
    title: 'Moj nalog',
    bodyHtml,
    userEmail: opts.userEmail,
    controlRegionName: opts.controlRegionName,
  });
}
