/**
 * Styles for admin tables and filter forms. Loaded alongside global STYLES
 * via admin-layout.ts.
 */
export const ADMIN_TABLE_STYLES = /* css */ `
  /* ====== Filter form ====== */
  /* Mobile (≤719px): wrap into a column so everything fits. */
  .filters {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    box-sizing: border-box;
    /* Important: the card fills the parent instead of behaving like max-content. */
    width: 100%;
    margin-bottom: 16px;
  }
  /* Desktop (≥720px): one row, never wrap. Municipality flexible, dates and actions fixed. */
  @media (min-width: 720px) {
    .filters {
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: flex-end;
    }
    .filters > .field:first-child { flex: 0 1 280px; min-width: 0; }
    .filters > .field:not(:first-child) { flex: 0 0 140px; min-width: 0; }
    .filters > .actions { flex: 0 0 auto; min-width: 0; }
  }
  .filters .field { margin: 0; min-width: 0; }
  /* Elements inside a field must respect the field width (otherwise the select
     tries min-width = longest option width and breaks the layout). */
  .filters .field > input,
  .filters .field > select {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
  }
  /* Hint below the input that does NOT shift vertical layout (absolutely positioned).
     So align-items:end stays in place while the hint appears below the input. */
  .filters .field.has-hint { position: relative; }
  .filters .field.has-hint .hint {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    font-size: 12px;
    color: var(--c-text-muted);
    line-height: 1.4;
  }
  .filters .field label {
    font-size: 12px;
    color: var(--c-text-muted);
    margin-bottom: 4px;
    font-weight: 500;
    letter-spacing: 0.01em;
    text-transform: uppercase;
  }
  .filters input,
  .filters select {
    padding: 10px 12px;
    font-size: 15px;
  }
  .filters .actions {
    display: flex;
    gap: 8px;
    flex-wrap: nowrap;
    align-items: center;
  }
  .filters button[type="submit"],
  .filters a.btn {
    width: auto;
    flex: 0 0 auto;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    border: 1px solid var(--c-border-strong);
    background: var(--c-surface);
    color: var(--c-text);
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.12s ease, border-color 0.12s ease;
    font-family: inherit;
  }
  .filters button[type="submit"] {
    background: var(--c-primary);
    color: #fff;
    border-color: var(--c-primary);
  }
  .filters button[type="submit"]:hover {
    background: var(--c-primary-hover);
    border-color: var(--c-primary-hover);
  }
  .filters a.btn:hover { background: var(--c-surface-alt); }

  /* ====== Summary bar (count + export links) ====== */
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
    font-size: 14px;
    color: var(--c-text-soft);
  }
  .summary .export-links {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .summary .export-links a {
    color: var(--c-text);
    text-decoration: none;
    padding: 6px 10px;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    background: var(--c-surface);
    transition: background-color 0.12s ease;
  }
  .summary .export-links a:hover {
    background: var(--c-surface-alt);
  }

  /* ====== Table ====== */
  .table-wrap {
    /* Horizontal scroll on narrow screens — table stays readable */
    overflow-x: auto;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
    background: var(--c-surface);
    -webkit-overflow-scrolling: touch;
  }
  table.list {
    width: 100%;
    min-width: 720px; /* triggers scroll on screens <720px */
    border-collapse: collapse;
    font-size: 13.5px;
  }
  table.list th,
  table.list td {
    padding: 12px 14px;
    text-align: left;
    border-bottom: 1px solid #f1f1f1;
    white-space: nowrap;
  }
  /* Email and polling-station (BM) columns may wrap (often long values) */
  table.list td.wrap, table.list th.wrap {
    white-space: normal;
    word-break: break-word;
  }
  table.list th {
    background: var(--c-surface-alt);
    font-weight: 600;
    color: var(--c-text-soft);
    font-size: 11.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
  }
  table.list tr:last-child td { border-bottom: 0; }
  table.list tr:hover td { background: #fafafa; }
  table.list .short-code {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--c-text-muted);
    letter-spacing: 0.03em;
  }
  table.list .name {
    font-weight: 500;
    color: var(--c-text);
  }

  /* ====== Pagination ====== */
  .pagination {
    display: flex;
    justify-content: center;
    gap: 4px;
    padding: 20px 0;
    flex-wrap: wrap;
  }
  .pagination a,
  .pagination span {
    padding: 7px 12px;
    border: 1px solid var(--c-border);
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--c-text);
    font-size: 14px;
    background: var(--c-surface);
    min-width: 36px;
    text-align: center;
    transition: background-color 0.12s ease;
  }
  .pagination a:hover { background: var(--c-surface-alt); }
  .pagination .current {
    background: var(--c-primary);
    color: #fff;
    border-color: var(--c-primary);
    font-weight: 600;
  }
  .pagination .disabled {
    color: #d4d4d4;
    background: var(--c-surface);
    pointer-events: none;
  }

  /* ====== Empty state ====== */
  .empty {
    text-align: center;
    padding: 64px 16px;
    color: var(--c-text-muted);
    font-size: 15px;
    background: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
  }

  /* ====== Survey toggle page ====== */
  .anketa-status {
    padding: 18px 20px;
    border-radius: var(--radius-md);
    margin: 20px 0;
    font-size: 14.5px;
    border: 1px solid;
    display: flex;
    align-items: center;
    gap: 14px;
    line-height: 1.5;
  }
  .anketa-status .badge {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    font-size: 18px;
    font-weight: 700;
  }
  .anketa-status.open {
    background: var(--c-success-soft);
    border-color: #bbf7d0;
    color: #14532d;
  }
  .anketa-status.open .badge {
    background: #bbf7d0;
    color: #14532d;
  }
  .anketa-status.closed {
    background: var(--c-warning-soft);
    border-color: #fde68a;
    color: #78350f;
  }
  .anketa-status.closed .badge {
    background: #fde68a;
    color: #78350f;
  }

  .danger-btn, .success-btn {
    width: auto;
    padding: 11px 18px;
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: 0;
    transition: background-color 0.12s ease;
    font-family: inherit;
  }
  .danger-btn {
    background: var(--c-primary);
    color: #fff;
  }
  .danger-btn:hover { background: var(--c-primary-hover); }
  .success-btn {
    background: #166534;
    color: #fff;
  }
  .success-btn:hover { background: #14532d; }

  .anketa-hero {
    margin-bottom: 8px;
  }
  .anketa-hero h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .anketa-hero p {
    margin: 4px 0 0;
    color: var(--c-text-muted);
    font-size: 14px;
  }

  /* ====== Admin users (admini) ====== */
  .state-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    line-height: 1.4;
    vertical-align: middle;
  }
  .state-badge.state-active {
    background: var(--c-success-soft);
    color: var(--c-success);
  }
  .state-badge.state-inactive {
    background: var(--c-surface-alt);
    color: var(--c-text-muted);
  }
  .state-badge.state-self {
    background: #fef3c7;
    color: #78350f;
    margin-left: 6px;
  }
  .state-badge.state-cr {
    background: #e0e7ff;
    color: #3730a3;
  }
  .state-badge.state-muni {
    background: #fce7f3;
    color: #9d174d;
  }
  tr.deactivated td { opacity: 0.6; }
  tr.deactivated .name { text-decoration: line-through; }

  .actions-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
  }
  @media (min-width: 720px) {
    .actions-cell { flex-direction: row; flex-wrap: wrap; gap: 6px; }
  }
  .inline-action { display: inline; margin: 0; }
  /* Discrete table buttons — outline style, not dominant. */
  .link-btn {
    width: auto;
    background: transparent;
    border: 1px solid var(--c-border-strong);
    padding: 6px 12px;
    margin: 0;
    color: var(--c-text);
    font-size: 12.5px;
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
    border-radius: var(--radius-sm);
    text-decoration: none;
    box-shadow: none;
    transition: background-color 0.12s ease, border-color 0.12s ease, color 0.12s ease;
    letter-spacing: 0;
  }
  .link-btn:hover {
    background: var(--c-surface-alt);
    border-color: var(--c-text-soft);
  }
  .link-btn.danger {
    color: var(--c-primary);
    border-color: var(--c-primary);
  }
  .link-btn.danger:hover {
    background: var(--c-primary);
    color: #fff;
    border-color: var(--c-primary);
  }

  /* ====== Audit log ====== */
  .audit-filters {
    grid-template-columns: 1fr;
  }
  @media (min-width: 720px) {
    .audit-filters {
      grid-template-columns: 1fr 1fr 1fr 0.8fr 0.8fr auto;
    }
  }
  .event-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1.5;
    white-space: nowrap;
  }
  .event-badge.event-success {
    background: var(--c-success-soft);
    color: var(--c-success);
  }
  .event-badge.event-warning {
    background: var(--c-warning-soft);
    color: var(--c-warning);
  }
  .event-badge.event-error {
    background: var(--c-primary-soft);
    color: var(--c-danger);
  }
  .event-badge.event-info {
    background: var(--c-surface-alt);
    color: var(--c-text-soft);
  }
  .audit-table .meta-cell code {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--c-text-soft);
    background: var(--c-surface-alt);
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: break-all;
  }
  .audit-table .nowrap { white-space: nowrap; }
`;
