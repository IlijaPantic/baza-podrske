import { escapeHtml, layout } from './layout';

/**
 * Page shown after successful registration.
 * Shows only the short_id so the user has a reference (e.g. for support).
 */
export function thankYouPage(shortId?: string): string {
  const bodyHtml = `
    <div class="card status-card">
      <div class="status-icon" aria-hidden="true">✓</div>
      <h2>Hvala vam!</h2>
      <p>Vaša prijava je uspešna. Kontaktiraćemo vas telefonom ili emailom kad obuke budu aktivne.</p>
      ${shortId ? `<div class="short-id">Vaš broj prijave: ${escapeHtml(shortId)}</div>` : ''}
    </div>
  `;
  return layout({ title: 'Hvala — prijava primljena', bodyHtml });
}
