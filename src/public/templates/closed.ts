import { layout } from './layout';

/**
 * Page shown when the admin has closed the survey.
 */
export function closedPage(): string {
  const bodyHtml = `
    <div class="card status-card">
      <div class="status-icon warn" aria-hidden="true">!</div>
      <h2>Anketa je zatvorena</h2>
      <p>Trenutno ne primamo nove prijave. Hvala na interesovanju.</p>
    </div>
  `;
  return layout({ title: 'Anketa zatvorena', bodyHtml });
}
