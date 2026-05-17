import { z } from 'zod';

/**
 * Zod schema for POST /api/submit.
 * Strictly validates all input before it reaches the service.
 *
 * Honeypot: if `_hp` field has any value — it's a bot. We ignore
 * with silent 200 (success), no row stored.
 *
 * Required fields (per spec v0.7): firstName, lastName, opstinaSlug,
 * phone, email. Everything else (birthYear, pollingStationId) is optional.
 * Implicit consent — submitting the form accepts terms. consent_at
 * is set automatically in the service at submit time.
 */

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Helper: turns "", null, undefined → undefined. For string and numeric
 * fields that are optional — frontend often sends "" or null instead of
 * omitting the field.
 */
const emptyToUndef = z.preprocess((v) => {
  if (v === '' || v === null) return undefined;
  return v;
}, z.unknown());

export const SubmitSchema = z.object({
  // Core fields — required
  firstName: z.string().trim().min(1, 'Ime je obavezno').max(80, 'Ime je predugačko'),
  lastName: z.string().trim().min(1, 'Prezime je obavezno').max(80, 'Prezime je predugačko'),

  // Birth year — optional
  birthYear: emptyToUndef.pipe(
    z
      .coerce
      .number()
      .int()
      .min(1900, 'Godište nije validno')
      .max(CURRENT_YEAR, 'Godište ne može biti u budućnosti')
      .optional(),
  ),

  // Municipality — required
  opstinaSlug: z.string().trim().min(1, 'Opština je obavezna').max(80),

  // Polling station — optional
  pollingStationId: emptyToUndef.pipe(
    z.coerce.number().int().positive().optional(),
  ),

  // Contact — required (original value, normalization in service)
  phone: z.string().trim().min(6, 'Telefon je obavezan').max(40),
  email: z.string().trim().min(3, 'Email je obavezan').max(254),

  // Honeypot — must always be empty
  _hp: z.string().optional().default(''),

  // Form token (time-to-fill heuristic) — verified BEFORE Zod in controller,
  // here we only allow it in body without Zod error.
  _t: z.string().max(200).optional(),
});

export type SubmitDto = z.infer<typeof SubmitSchema>;
