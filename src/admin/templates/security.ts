import { adminLayout, escapeHtml } from '../../auth/templates/admin-layout';

export type SecurityPageOpts = {
  userEmail: string;
  controlRegionName: string;
  csrfToken: string;
  /** Whether 2FA is currently enabled for this admin */
  totpEnabled: boolean;
  /** When it was enabled (if it is). */
  totpEnabledAt: Date | null;
  /** Enrollment in progress — server returns QR + secret + code field. */
  enrollment?: {
    secret: string;
    otpAuthUri: string;
    qrDataUrl: string;
  };
  /** Global info message. */
  message?: string;
  /** Global error message. */
  error?: string;
};

const DATE_FMT = new Intl.DateTimeFormat('sr-Latn-RS', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function securityPage(opts: SecurityPageOpts): string {
  const body = `
    <header class="header">
      <h1 style="font-size:22px;margin-bottom:4px">Bezbednost naloga</h1>
      <p style="font-size:14px;color:var(--c-text-soft)">
        Dvostruka provera (2FA) putem authenticator app-a kao što su Google
        Authenticator, Authy, 1Password ili Bitwarden.
      </p>
    </header>

    ${opts.message ? `<div class="global-success">${escapeHtml(opts.message)}</div>` : ''}
    ${opts.error ? `<div class="global-error">${escapeHtml(opts.error)}</div>` : ''}

    ${renderStatusCard(opts)}
    ${opts.enrollment ? renderEnrollment(opts) : ''}
    ${opts.totpEnabled && !opts.enrollment ? renderDisableForm(opts) : ''}
  `;

  return adminLayout({
    title: 'Bezbednost',
    bodyHtml: body,
    userEmail: opts.userEmail,
    controlRegionName: opts.controlRegionName,
  });
}

function renderStatusCard(opts: SecurityPageOpts): string {
  if (opts.totpEnabled) {
    return `
      <div class="anketa-status open" style="margin-top:20px">
        <span class="badge">✓</span>
        <div>
          <strong>2FA je aktivan</strong> za vaš nalog.<br>
          <span class="muted" style="font-size:13px">
            Aktiviran ${opts.totpEnabledAt ? DATE_FMT.format(opts.totpEnabledAt) : '—'}.
            Pri svakoj prijavi traži se 6-cifreni kod iz vašeg authenticator app-a.
          </span>
        </div>
      </div>
    `;
  }
  return `
    <div class="anketa-status closed" style="margin-top:20px">
      <span class="badge">!</span>
      <div>
        <strong>2FA nije aktivan.</strong><br>
        <span class="muted" style="font-size:13px">
          Preporučujemo da uključite 2FA — značajno povećava bezbednost vašeg
          naloga čak i ako neko sazna vašu lozinku.
        </span>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <form method="POST" action="/kontrola-admin/2fa/zapocni" autocomplete="off">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <button type="submit">Uključi 2FA</button>
      </form>
    </div>
  `;
}

function renderEnrollment(opts: SecurityPageOpts): string {
  const e = opts.enrollment!;
  return `
    <div class="card" style="margin-top:24px">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:600">Korak 1: Skenirajte QR kod</h2>
      <p style="margin:0 0 16px;color:var(--c-text-soft);font-size:14px;line-height:1.5">
        Otvorite authenticator app na telefonu (Google Authenticator, Authy,
        1Password, Bitwarden, itd.) i skenirajte QR kod ispod, ili ručno
        unesite ključ.
      </p>

      <div style="display:flex;flex-direction:column;align-items:center;gap:16px;margin:20px 0">
        <img src="${escapeHtml(e.qrDataUrl)}" alt="2FA QR kod"
             style="width:200px;height:200px;border:1px solid var(--c-border);border-radius:8px;background:#fff;padding:8px" />

        <details style="width:100%;max-width:420px">
          <summary style="cursor:pointer;color:var(--c-text-soft);font-size:13px">
            Ne radi QR? Otvori za ručni unos
          </summary>
          <div style="margin-top:12px;padding:12px;background:var(--c-surface-alt);border-radius:6px">
            <div style="font-size:12px;color:var(--c-text-muted);margin-bottom:4px">KLJUČ</div>
            <code style="font-family:var(--font-mono);font-size:13px;word-break:break-all;color:var(--c-text)">
              ${escapeHtml(e.secret)}
            </code>
            <div style="font-size:12px;color:var(--c-text-muted);margin-top:10px;line-height:1.5">
              Tip: 30 sek, 6 cifara, SHA1 (standard).
            </div>
          </div>
        </details>
      </div>

      <h2 style="margin:24px 0 12px;font-size:16px;font-weight:600">Korak 2: Potvrdite kodom</h2>
      <p style="margin:0 0 16px;color:var(--c-text-soft);font-size:14px">
        Unesite 6-cifreni kod koji se trenutno prikazuje u app-u.
      </p>

      <form method="POST" action="/kontrola-admin/2fa/potvrdi" autocomplete="off">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <input type="hidden" name="secret" value="${escapeHtml(e.secret)}" />
        <div class="filters" style="grid-template-columns:1fr auto;margin-bottom:0;padding:0;background:transparent;border:0">
          <div class="field">
            <label for="enrollCode">6-cifreni kod</label>
            <input id="enrollCode" name="code" type="text"
              inputmode="numeric" pattern="[0-9]*"
              required minlength="6" maxlength="7"
              autocomplete="one-time-code" autocapitalize="off" spellcheck="false"
              style="letter-spacing:.2em;text-align:center;font-size:1.2rem" />
          </div>
          <div class="actions">
            <button type="submit">Aktiviraj 2FA</button>
          </div>
        </div>
      </form>

      <form method="POST" action="/kontrola-admin/2fa/otkazi" style="margin-top:12px">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <button type="submit" class="link-btn">Otkaži</button>
      </form>
    </div>
  `;
}

function renderDisableForm(opts: SecurityPageOpts): string {
  return `
    <div class="card" style="margin-top:24px">
      <h2 style="margin:0 0 12px;font-size:16px;font-weight:600">Isključi 2FA</h2>
      <p style="margin:0 0 16px;color:var(--c-text-soft);font-size:14px;line-height:1.5">
        Da bi sprečili neovlašćeno isključivanje, potrebno je da unesete
        trenutni 6-cifreni kod iz authenticator app-a.
      </p>
      <form method="POST" action="/kontrola-admin/2fa/iskljuci" autocomplete="off">
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <div class="filters" style="grid-template-columns:1fr auto;margin-bottom:0;padding:0;background:transparent;border:0">
          <div class="field">
            <label for="disableCode">6-cifreni kod</label>
            <input id="disableCode" name="code" type="text"
              inputmode="numeric" pattern="[0-9]*"
              required minlength="6" maxlength="7"
              autocomplete="one-time-code" autocapitalize="off" spellcheck="false"
              style="letter-spacing:.2em;text-align:center;font-size:1.2rem" />
          </div>
          <div class="actions">
            <button type="submit" class="link-btn danger">Isključi 2FA</button>
          </div>
        </div>
      </form>
    </div>
  `;
}
