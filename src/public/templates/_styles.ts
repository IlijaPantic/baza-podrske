/**
 * Global styles — modern, mobile-first.
 *
 * Palette: black/white with a discreet red accent (student-movement allusion,
 * subtle). All colors via CSS variables, easy to change in one place.
 */
export const STYLES = /* css */ `
  :root {
    /* Background and surfaces stay neutral, only tinted toward warm */
    --c-bg:           #faf6f6;
    --c-surface:      #ffffff;
    --c-surface-alt:  #f4eded;
    /* Text is not pure black — deep burgundy tint */
    --c-text:         #2a0a0a;
    --c-text-soft:    #5a3838;
    --c-text-muted:   #8a6a6a;
    --c-border:       #e8dcdc;
    --c-border-strong:#d4c0c0;
    /* Main burgundy palette (student movement) */
    --c-primary:      #7c1d1d;
    --c-primary-hover:#5e1414;
    --c-primary-dark: #4a0e0e;
    --c-primary-soft: #fbeaea;
    --c-success:      #15803d;
    --c-success-soft: #f0fdf4;
    --c-warning:      #b45309;
    --c-warning-soft: #fffbeb;
    --c-danger:       #7c1d1d;
    --c-focus-ring:   rgba(124, 29, 29, 0.18);
    --shadow-sm:      0 1px 2px rgba(0,0,0,0.04);
    --shadow-md:      0 4px 12px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.04);
    --radius-sm:      8px;
    --radius-md:      12px;
    --radius-lg:      16px;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, monospace;
  }

  * { box-sizing: border-box; }
  html {
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    font-feature-settings: "cv11", "ss01", "ss03", "kern", "tnum";
  }
  body {
    margin: 0;
    background: var(--c-bg);
    color: var(--c-text);
    line-height: 1.5;
    min-height: 100vh;
    font-size: 16px;
  }

  /* ====== Layout containers ====== */
  .page {
    max-width: 640px;
    margin: 0 auto;
    padding: 24px 16px 64px;
  }
  @media (min-width: 640px) {
    .page { padding: 40px 24px 72px; }
  }

  /* ====== Headings ====== */
  .header {
    text-align: left;
    margin-bottom: 24px;
  }
  .header .kicker {
    display: block;
    margin: 0 0 10px;
    color: var(--c-primary);
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.02em;
    line-height: 1.15;
    text-transform: uppercase;
  }
  @media (min-width: 640px) {
    .header .kicker { font-size: 26px; }
  }
  .header h1 {
    margin: 0 0 6px;
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--c-text);
    line-height: 1.25;
  }
  @media (min-width: 640px) {
    .header h1 { font-size: 24px; }
  }
  .header p {
    margin: 0;
    color: var(--c-text-soft);
    font-size: 15px;
  }

  /* ====== Card / form ====== */
  .card {
    background: var(--c-surface);
    border-radius: var(--radius-md);
    border: 1px solid var(--c-border);
    padding: 20px;
    box-shadow: var(--shadow-sm);
  }
  @media (min-width: 640px) {
    .card { padding: 28px; }
  }

  /* ====== Form fields ====== */
  .field {
    margin-bottom: 20px;
  }
  .field:last-of-type { margin-bottom: 0; }
  .field label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    margin-bottom: 6px;
    color: var(--c-text);
    letter-spacing: -0.005em;
  }
  .field .hint {
    display: block;
    font-size: 12.5px;
    color: var(--c-text-muted);
    margin-top: 6px;
    line-height: 1.4;
  }
  .field .error {
    display: block;
    font-size: 13px;
    color: var(--c-primary);
    margin-top: 6px;
    font-weight: 500;
    min-height: 0;
  }

  input[type="text"],
  input[type="email"],
  input[type="tel"],
  input[type="number"],
  input[type="password"],
  input[type="date"],
  select {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    padding: 12px 14px;
    /* 16px prevents iOS Safari from zooming on focus */
    font-size: 16px;
    font-family: inherit;
    border: 1px solid var(--c-border-strong);
    border-radius: var(--radius-sm);
    background: var(--c-surface);
    color: var(--c-text);
    line-height: 1.4;
    transition: border-color 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
  }
  select {
    /* Custom arrow (appearance:none removed the default) */
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%23737373' d='M2 4l4 4 4-4z'/></svg>");
    background-repeat: no-repeat;
    background-position: right 14px center;
    padding-right: 38px;
  }
  input::placeholder { color: #a3a3a3; }
  input:hover, select:hover {
    border-color: #a3a3a3;
  }
  input:focus, select:focus {
    outline: none;
    border-color: var(--c-primary);
    box-shadow: 0 0 0 4px var(--c-focus-ring);
  }
  input:disabled, select:disabled {
    background: var(--c-surface-alt);
    color: var(--c-text-muted);
    cursor: not-allowed;
    border-color: var(--c-border);
  }

  /* Hide browser password-field revealers that break width */
  input[type="password"]::-ms-reveal,
  input[type="password"]::-ms-clear,
  input[type="password"]::-webkit-credentials-auto-fill-button {
    display: none !important;
  }

  /* ====== Checkbox (consent) ====== */
  .checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    font-size: 13.5px;
    color: var(--c-text-soft);
    line-height: 1.5;
    user-select: none;
  }
  .checkbox-row input[type="checkbox"] {
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    accent-color: var(--c-primary);
    cursor: pointer;
  }
  .checkbox-row span { display: block; }
  .consent-field { margin-top: 18px; margin-bottom: 0; }

  /* "optional" tag next to label */
  .opt-tag {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 8px;
    background: var(--c-surface-alt);
    color: var(--c-text-muted);
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.01em;
    text-transform: uppercase;
    vertical-align: middle;
  }

  /* Fineprint under submit button — implicit consent text */
  .fineprint {
    margin: 16px 0 0;
    font-size: 12.5px;
    color: var(--c-text-muted);
    line-height: 1.5;
    text-align: center;
  }

  /* Submit button — burgundy, not black.
     NB: we deliberately exclude .link-btn and .danger-btn / .success-btn so
     scoped tab-bar styles (e.g. in admin panel) can override them
     without specificity wars. */
  button[type="submit"]:not(.link-btn):not(.danger-btn):not(.success-btn),
  .btn-primary {
    width: 100%;
    padding: 14px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.01em;
    background: var(--c-primary);
    color: #fff;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color 0.12s ease, transform 0.06s ease, box-shadow 0.12s ease;
    font-family: inherit;
    box-shadow: 0 1px 2px rgba(124, 29, 29, 0.15);
  }
  button[type="submit"]:not(.link-btn):not(.danger-btn):not(.success-btn):hover:not(:disabled),
  .btn-primary:hover:not(:disabled) {
    background: var(--c-primary-hover);
    box-shadow: 0 2px 6px rgba(124, 29, 29, 0.22);
  }
  button[type="submit"]:not(.link-btn):not(.danger-btn):not(.success-btn):active:not(:disabled) {
    transform: scale(0.99);
  }
  button[type="submit"]:not(.link-btn):not(.danger-btn):not(.success-btn):disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  /* Space between last field in card and submit button.
     Without this, submit sticks to the last input (.field:last-of-type has margin-bottom: 0). */
  .card .field + button[type="submit"]:not(.link-btn):not(.danger-btn):not(.success-btn),
  .card .global-error + button[type="submit"]:not(.link-btn):not(.danger-btn):not(.success-btn) {
    margin-top: 24px;
  }

  /* Errors */
  .global-error {
    background: var(--c-primary-soft);
    border: 1px solid #fecaca;
    color: var(--c-danger);
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    font-size: 14px;
    margin-bottom: 16px;
    line-height: 1.5;
  }
  .global-success {
    background: var(--c-success-soft);
    border: 1px solid #bbf7d0;
    color: var(--c-success);
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    font-size: 14px;
    margin-bottom: 16px;
    line-height: 1.5;
  }

  /* Honeypot — totally hidden */
  .hp {
    position: absolute !important;
    left: -9999px !important;
    top: -9999px !important;
    width: 1px !important;
    height: 1px !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }

  /* Status pages (thank-you, closed) */
  .status-card {
    text-align: center;
    padding: 48px 24px;
  }
  .status-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--c-success-soft);
    color: var(--c-success);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    font-weight: 700;
    margin-bottom: 20px;
  }
  .status-icon.warn {
    background: var(--c-warning-soft);
    color: var(--c-warning);
  }
  .status-card h2 {
    margin: 0 0 12px;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .status-card p {
    margin: 0;
    color: var(--c-text-soft);
    font-size: 15px;
    max-width: 360px;
    margin-left: auto;
    margin-right: auto;
  }
  .short-id {
    display: inline-block;
    margin-top: 24px;
    padding: 10px 16px;
    background: var(--c-surface-alt);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 600;
    color: var(--c-text);
    letter-spacing: 0.04em;
  }
  .footer {
    text-align: center;
    font-size: 12px;
    color: var(--c-text-muted);
    margin-top: 32px;
  }
`;
