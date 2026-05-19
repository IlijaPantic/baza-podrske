import type { OpstinaListItem, BmListItem } from '../../polling-stations/polling-stations.service';
import { escapeHtml, layout, safeJson } from './layout';

export type FormPageOpts = {
  /** List of municipalities for the <select> dropdown. */
  opstine: OpstinaListItem[];
  /** All polling stations grouped by opstina_slug — embedded in <script> for client-side filtering. */
  bmByOpstina: Record<string, BmListItem[]>;
  /** When ?opstina=novi-sad comes from the URL — it is pre-selected. */
  prefilledOpstina?: string;
};

const CURRENT_YEAR = new Date().getFullYear();

export function formPage({ opstine, bmByOpstina, prefilledOpstina }: FormPageOpts): string {
  const bodyHtml = `
    <header class="header">
      <span class="kicker">Studenti pobeđuju!</span>
      <h1>Prijava za obuku kontrolora izbora</h1>
      <p>Popunite formu - javljamo vam se uskoro.</p>
    </header>
    <noscript>
      <div class="global-error">
        Za ovu formu potreban je JavaScript. Molimo uključite ga i osvežite stranicu.
      </div>
    </noscript>
    <form id="reg-form" class="card" novalidate autocomplete="off">
      <div id="global-error" class="global-error" style="display:none"></div>

      <div class="field">
        <label for="firstName">Ime</label>
        <input id="firstName" name="firstName" type="text" required maxlength="80" autocomplete="given-name" />
        <span class="error" data-error-for="firstName"></span>
      </div>

      <div class="field">
        <label for="lastName">Prezime</label>
        <input id="lastName" name="lastName" type="text" required maxlength="80" autocomplete="family-name" />
        <span class="error" data-error-for="lastName"></span>
      </div>

      <div class="field">
        <label for="birthYear">Godište <span class="opt-tag">opciono</span></label>
        <input id="birthYear" name="birthYear" type="number" inputmode="numeric" min="1900" max="${CURRENT_YEAR}" />
        <span class="hint">Godina rođenja (npr. 1985).</span>
        <span class="error" data-error-for="birthYear"></span>
      </div>

      <div class="field">
        <label for="opstinaSlug">Opština</label>
        <select id="opstinaSlug" name="opstinaSlug" required>
          <option value="">— Izaberite opštinu —</option>
          ${opstine
            .map((o) => {
              const acr = o.controlRegionAcronym
                ? `${o.controlRegionAcronym}, `
                : '';
              return `<option value="${escapeHtml(o.slug)}"${
                prefilledOpstina === o.slug ? ' selected' : ''
              }>${escapeHtml(o.naziv)} (${acr}${o.bmCount} BM)</option>`;
            })
            .join('\n          ')}
        </select>
        <span class="error" data-error-for="opstinaSlug"></span>
      </div>

      <div class="field">
        <label for="pollingStationId">Biračko mesto</label>
        <select id="pollingStationId" name="pollingStationId" disabled>
          <option value="">— Prvo izaberite opštinu —</option>
        </select>
        <span class="hint">Ako znate, izaberite svoje biračko mesto. Proveru mozete da uradite <a href="https://upit.birackispisak.gov.rs/" target="_blank">ovde</a>.</span>
        <span class="error" data-error-for="pollingStationId"></span>
      </div>

      <div class="field">
        <label for="phone">Telefon</label>
        <input id="phone" name="phone" type="tel" required
          inputmode="tel"
          autocomplete="tel"
          pattern="[+0-9]*"
          maxlength="20"
          placeholder="0651234567" />
        <span class="hint">Samo cifre (npr. <code>0651234567</code> ili <code>+381651234567</code>). Bez razmaka.</span>
        <span class="error" data-error-for="phone"></span>
      </div>

      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required autocomplete="email" maxlength="254" />
        <span class="error" data-error-for="email"></span>
      </div>

      <!-- Honeypot — bots fill this, humans don't see it -->
      <div class="hp" aria-hidden="true">
        <label for="_hp">Ne popunjavajte ovo polje:</label>
        <input id="_hp" name="_hp" type="text" tabindex="-1" autocomplete="off" />
      </div>

      <!-- Consent — front-end only (not stored in DB). Required, JS validates before submit. -->
      <div class="field consent-field">
        <label class="checkbox-row" for="consent">
          <input id="consent" type="checkbox" required />
          <span>
            Dajem svoj pristanak u skladu sa Zakonom o zaštiti podataka o ličnosti
            da studenti u blokadi kao rukovaoci obrađuju podatke o ličnosti u svrhu
            preduzimanja opisanih radnji od strane rukovaoca lica čiji se podaci
            o ličnosti obrađuju i da podaci o ličnosti mogu biti prosleđivani
            drugom rukovaocu, obrađivaču i trećim licima.
          </span>
        </label>
        <span class="error" data-error-for="consent"></span>
      </div>

      <button type="submit" id="submitBtn">Pošalji prijavu</button>
    </form>
  `;

  // Client-side JS — filters polling-station dropdown, sends JSON POST
  const inlineScript = `
(function(){
  'use strict';
  const BM_DATA = ${safeJson(bmByOpstina)};
  const form = document.getElementById('reg-form');
  const opstinaSel = document.getElementById('opstinaSlug');
  const bmSel = document.getElementById('pollingStationId');
  const phoneInput = document.getElementById('phone');
  const submitBtn = document.getElementById('submitBtn');
  const globalErr = document.getElementById('global-error');

  // Phone: allow ONLY digits and one + at the start.
  // Filters in real time (typing and paste both).
  function sanitizePhone(s){
    var cleaned = String(s == null ? '' : s).replace(/[^+0-9]/g, '');
    // Plus allowed only at the first position and only once
    var hasPlus = cleaned.charAt(0) === '+';
    cleaned = cleaned.replace(/\\+/g, '');
    return (hasPlus ? '+' : '') + cleaned;
  }
  phoneInput.addEventListener('input', function(){
    var s = sanitizePhone(phoneInput.value);
    if (s !== phoneInput.value){
      var pos = phoneInput.selectionStart;
      phoneInput.value = s;
      // After filtering, put cursor at end (simple and reliable)
      try { phoneInput.setSelectionRange(s.length, s.length); } catch(e){}
    }
  });
  phoneInput.addEventListener('paste', function(e){
    // input event will still fire after paste, but this prevents flicker
    setTimeout(function(){
      phoneInput.value = sanitizePhone(phoneInput.value);
    }, 0);
  });

  function clearErrors(){
    globalErr.style.display = 'none';
    globalErr.textContent = '';
    document.querySelectorAll('[data-error-for]').forEach(function(el){ el.textContent = ''; });
  }
  function setFieldError(field, msg){
    const el = document.querySelector('[data-error-for="' + field + '"]');
    if (el) el.textContent = msg;
  }
  function setGlobalError(msg){
    globalErr.textContent = msg;
    globalErr.style.display = 'block';
    globalErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function populateBm(){
    const slug = opstinaSel.value;
    const list = BM_DATA[slug] || [];
    bmSel.innerHTML = '';
    if (!slug || list.length === 0){
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— Prvo izaberite opštinu —';
      bmSel.appendChild(opt);
      bmSel.disabled = true;
      return;
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Izaberite biračko mesto —';
    bmSel.appendChild(placeholder);
    list.forEach(function(bm){
      const opt = document.createElement('option');
      opt.value = String(bm.id);
      opt.textContent = bm.naziv;
      bmSel.appendChild(opt);
    });
    bmSel.disabled = false;
  }

  opstinaSel.addEventListener('change', populateBm);
  populateBm(); // in case municipality was pre-filled from URL

  // ====== Form token (time-to-fill anti-bot heuristic) ============
  // Server issues HMAC token that carries timestamp. Submit requires token
  // that is at least 3s old (bot is too fast) and max 4h (form left open too long).
  // We do NOT cache tokens in localStorage — always fresh per session.
  var formToken = '';
  var tokenFetchedAt = 0;
  function fetchFormToken(){
    return fetch('/api/form-token', { credentials: 'omit', cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if (data && data.token) {
          formToken = data.token;
          tokenFetchedAt = Date.now();
        }
      })
      .catch(function(){ /* simply stays empty; submit will tell user to refresh */ });
  }
  fetchFormToken();
  // If page has been open longer than 3.5h, fetch fresh token before it expires
  setInterval(function(){
    if (Date.now() - tokenFetchedAt > 3.5 * 60 * 60 * 1000) fetchFormToken();
  }, 30 * 60 * 1000);

  // Reset form on refresh and back/forward navigation.
  // pageshow fires after bfcache restore too (event.persisted === true)
  // unlike load which does not. We clear all fields except municipality
  // that was pre-filled from URL (server-side).
  function resetForm(){
    var preselectedOpstina = opstinaSel.querySelector('option[selected]');
    var preselectedSlug = preselectedOpstina ? preselectedOpstina.value : '';
    form.reset();
    if (preselectedSlug) opstinaSel.value = preselectedSlug;
    populateBm();
    clearErrors();
    submitBtn.disabled = false;
    submitBtn.textContent = 'Pošalji prijavu';
  }
  window.addEventListener('pageshow', function(ev){
    // ev.persisted === true means page was restored from bfcache;
    // we still reset on "fresh" load (ensures empty field
    // after refresh in Firefox which keeps form state).
    resetForm();
  });

  form.addEventListener('submit', async function(ev){
    ev.preventDefault();
    clearErrors();

    // Consent — front-end-only validation; not in payload.
    var consentEl = document.getElementById('consent');
    if (!consentEl || !consentEl.checked) {
      setFieldError('consent', 'Morate dati saglasnost da nastavite.');
      setGlobalError('Označite saglasnost pre slanja.');
      return;
    }

    const fd = new FormData(form);
    const payload = {
      firstName: fd.get('firstName'),
      lastName: fd.get('lastName'),
      birthYear: fd.get('birthYear') || null,
      opstinaSlug: fd.get('opstinaSlug'),
      pollingStationId: fd.get('pollingStationId') || null,
      phone: fd.get('phone'),
      email: fd.get('email'),
      _hp: fd.get('_hp') || '',
      _t: formToken
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Šalje se...';

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(function(){ return {}; });

      if (res.ok && data.shortId){
        window.location.href = '/hvala?id=' + encodeURIComponent(data.shortId);
        return;
      }

      // 4xx — show per-field errors if server returns structured response
      if (data && Array.isArray(data.fieldErrors)){
        data.fieldErrors.forEach(function(fe){
          setFieldError(fe.field, fe.message);
        });
        setGlobalError('Proverite polja označena crveno.');
      } else if (data && data.message){
        setGlobalError(data.message);
        // Token issue? Try fetching fresh and let user
        // click submit again (will be >3s valid now).
        if (/sesija|token|isteklo|expired/i.test(String(data.message))) {
          fetchFormToken();
        }
      } else {
        setGlobalError('Došlo je do greške. Pokušajte ponovo.');
      }
    } catch(err){
      setGlobalError('Mreža nije dostupna. Pokušajte ponovo za par sekundi.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Pošalji prijavu';
    }
  });
})();
`;

  return layout({
    title: 'Prijava za obuku kontrolora izbora',
    bodyHtml,
    inlineScript,
  });
}
