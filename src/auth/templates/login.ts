import { adminLayout, escapeHtml } from './admin-layout';

export type LoginPageOpts = {
  /** Value from previous attempt (email only; password is never prefilled). */
  emailValue?: string;
  /** User-facing error from previous attempt. */
  error?: string;
  /** CSRF token for hidden field. */
  csrfToken?: string;
};

export function loginPage(opts: LoginPageOpts = {}): string {
  const bodyHtml = `
    <div class="login-shell">
      <header class="header">
        <span class="kicker">Studenti pobeđuju!</span>
        <h1>Kontrola — admin</h1>
        <p>Unesite svoj nalog za pristup panelu.</p>
      </header>
      <form method="POST" action="/kontrola-admin/login" class="card" novalidate autocomplete="off">
        ${opts.error ? `<div class="global-error">${escapeHtml(opts.error)}</div>` : ''}
        ${opts.csrfToken ? `<input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />` : ''}

        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            maxlength="254"
            value="${escapeHtml(opts.emailValue ?? '')}" />
        </div>

        <div class="field">
          <label for="password">Lozinka</label>
          <input id="password" name="password" type="password" required
            autocomplete="current-password"
            minlength="12"
            maxlength="200" />
        </div>

        <button type="submit">Prijavi se</button>
      </form>
    </div>
  `;

  return adminLayout({
    title: 'Prijava',
    bodyHtml,
  });
}

export type Login2faPageOpts = {
  /** Pending login token (HMAC) from step 1. */
  pendingToken: string;
  /** CSRF token for hidden field. */
  csrfToken: string;
  /** User-facing error. */
  error?: string;
};

/**
 * Step 2 — 2FA challenge. Shows only the 6-digit input for TOTP.
 * Pending token is carried in a hidden field (not in URL, to avoid leaking via
 * Referer or browser history).
 */
export function login2faPage(opts: Login2faPageOpts): string {
  const bodyHtml = `
    <div class="login-shell">
      <header class="header">
        <span class="kicker">Studenti pobeđuju!</span>
        <h1>Dvostruka provera</h1>
        <p>Unesite 6-cifreni kod iz svog authenticator app-a.</p>
      </header>
      <form method="POST" action="/kontrola-admin/login/2fa" class="card" novalidate autocomplete="off">
        ${opts.error ? `<div class="global-error">${escapeHtml(opts.error)}</div>` : ''}
        <input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}" />
        <input type="hidden" name="_pt" value="${escapeHtml(opts.pendingToken)}" />

        <div class="field">
          <label for="code">6-cifreni kod</label>
          <input id="code" name="code" type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="one-time-code"
            autocapitalize="off"
            spellcheck="false"
            maxlength="7"
            required
            autofocus
            style="letter-spacing: .3em; text-align: center; font-size: 1.4rem;" />
        </div>

        <button type="submit">Potvrdi</button>
        <p class="muted" style="margin-top: 1rem; font-size: .85rem;">
          Izgubili ste pristup app-u? Kontaktirajte drugog admina.
        </p>
      </form>
    </div>
  `;

  return adminLayout({
    title: 'Dvostruka provera',
    bodyHtml,
  });
}
