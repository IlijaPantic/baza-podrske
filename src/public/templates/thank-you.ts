import { escapeHtml, layout } from './layout';

/**
 * Page shown after successful registration.
 * Shows only the short_id so the user has a reference (e.g. for support).
 */
export function thankYouPage(shortId?: string): string {
  const bodyHtml = `
    <div class="card status-card">
      <div class="status-icon" aria-hidden="true">✓</div>
      <h2>Hvala vam što podržavate izbornu listu "Studentska lista - Studenti pobeđuju" pod rednim brojem 3!</h2>
    </div>
  `;
  return layout({ title: 'Hvala — prijava primljena', bodyHtml });
}
