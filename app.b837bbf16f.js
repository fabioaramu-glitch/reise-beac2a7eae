/* USA & Hawaii 2026 – Reisebegleiter (Fabio & Brenda)
   Daten: data.enc.json (AES-GCM, Schlüssel aus Zugangscode via PBKDF2).
   Zustand (Häkchen, Ausgaben): localStorage + optionaler verschlüsselter Sync über ein GitHub-Gist. */
(function () {
  'use strict';
  const LS = { code: 'usa26.code', state: 'usa26.state', prefs: 'usa26.prefs', data: 'usa26.datacache' };
  const BERLIN = 'Europe/Berlin';
  const TZ_LABEL = { 'Europe/Berlin': 'Berlin', 'America/Los_Angeles': 'LA', 'Pacific/Honolulu': 'Hawaii' };
  const TYPE_ICON = { flight: '✈️', arrival: '🛬', transfer: '🚕', stay: '🛏️', lounge: '🛋️', todo: '✅', idea: '💡', meal: '🍽️', park: '🎢' };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = new TextEncoder(), dec = new TextDecoder();

  let TRIP = null, KEY = null, STATE = null;
  let prefs = Object.assign({ tab: 'heute', me: '', budgetMode: 'ziel', onlyOpen: false, hideA2HS: false }, readJSON(LS.prefs, {}));
  let viewDay = null; // vom Nutzer gewählter Tag in "Heute"
  let map = null;
  let tripsFocus = null; // Tag, zu dem der Fahrten-Tab springen soll
  const tripsHere = {}; // pro Fahrt: „ab meinem Standort“ an/aus (nur Sitzung)
  const TZ_OVERRIDE = new URLSearchParams(location.search).get('tz') || '';

  function readJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function savePrefs() { localStorage.setItem(LS.prefs, JSON.stringify(prefs)); }

  /* ---------- Crypto ---------- */
  const b64 = { to: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))), from: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) };
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }
  async function deriveKey(code, saltB64, iter) { return deriveRaw(normCode(code), saltB64, iter); }
  // Datenschlüssel = PBKDF2(Link-Code + ":" + PIN) – ohne PIN sind die Reisedaten nicht entschlüsselbar
  async function deriveDataKey(code, pin, saltB64, iter) { return deriveRaw(normCode(code) + ':' + pin, saltB64, iter); }
  async function deriveRaw(pass, saltB64, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64.from(saltB64), iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function decryptJSON(key, box) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.from(box.iv) }, key, b64.from(box.ct));
    return JSON.parse(dec.decode(pt));
  }
  async function encryptJSON(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { v: 1, iv: b64.to(iv), ct: b64.to(ct) };
  }

  /* ---------- Zeit ---------- */
  const dtfCache = {};
  function dtf(tz) {
    return dtfCache[tz] || (dtfCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  }
  function partsIn(tz, ts) {
    const p = {}; dtf(tz).formatToParts(new Date(ts)).forEach((x) => { p[x.type] = x.value; });
    if (p.hour === '24') p.hour = '00';
    return p;
  }
  function offsetMs(tz, ts) { const p = partsIn(tz, ts); return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000; }
  function zoned(dateStr, timeStr, tz) {
    const [y, m, d] = dateStr.split('-').map(Number), [hh, mm] = timeStr.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    let ts = guess - offsetMs(tz, guess);
    ts = guess - offsetMs(tz, ts);
    return ts;
  }
  function dateIn(tz, ts) { const p = partsIn(tz, ts); return `${p.year}-${p.month}-${p.day}`; }
  function hm(tz, ts) { const p = partsIn(tz, ts); return `${p.hour}:${p.minute}`; }
  function deviceTz() { if (TZ_OVERRIDE) return TZ_OVERRIDE; try { return Intl.DateTimeFormat().resolvedOptions().timeZone || BERLIN; } catch (e) { return BERLIN; } }
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  function dObj(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); }
  function fmtDate(dateStr, long) { const o = dObj(dateStr); const dd = String(o.getUTCDate()).padStart(2, '0') + '.' + String(o.getUTCMonth() + 1).padStart(2, '0') + '.'; return (long ? WDL : WD)[o.getUTCDay()] + (long ? ', ' : ' ') + dd; }
  function dayDiff(a, b) { return Math.round((dObj(b) - dObj(a)) / 864e5); }
  const eur = (n) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
  const eur2 = (n) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const usd = (n) => Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' $';

  /* ---------- Zustand & Merge ---------- */
  function emptyState() { return { v: 1, checks: {}, items: {}, exp: {} }; }
  function loadState() { const s = readJSON(LS.state, null); STATE = Object.assign(emptyState(), s || {}); }
  function mergeMaps(a, b) {
    const out = Object.assign({}, a);
    for (const k in b) { if (!out[k] || (b[k].t || 0) > (out[k].t || 0)) out[k] = b[k]; }
    return out;
  }
  function mergeState(a, b) { return { v: 1, checks: mergeMaps(a.checks || {}, b.checks || {}), items: mergeMaps(a.items || {}, b.items || {}), exp: mergeMaps(a.exp || {}, b.exp || {}) }; }
  function stateSig(s) { const f = (m) => Object.keys(m).sort().map((k) => k + ':' + (m[k].t || 0)).join(','); return f(s.checks) + '|' + f(s.items) + '|' + f(s.exp); }
  function saveState(changed) {
    localStorage.setItem(LS.state, JSON.stringify(STATE));
    if (changed) Sync.schedule();
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- Sync (GitHub Gist, Ende-zu-Ende verschlüsselt) ---------- */
  const Sync = {
    status: 'off', last: 0, timer: null, busy: false, again: false, error: '',
    cfg() { const s = TRIP && TRIP.sync; if (!TRIP) return null; return s && s.provider === 'gist' && s.gistId && s.token ? s : null; },
    set(st, err) { this.status = st; this.error = err || ''; renderSyncPill(); },
    schedule(ms) { if (!this.cfg()) return; clearTimeout(this.timer); this.set('busy'); this.timer = setTimeout(() => this.run(), ms == null ? 1200 : ms); },
    async run() {
      const c = this.cfg(); if (!c) { this.set('off'); return; }
      if (this.busy) { this.again = true; return; }
      if (!navigator.onLine) { this.set('err', 'offline'); return; }
      this.busy = true; this.set('busy');
      const H = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json' };
      try {
        const r = await fetch('https://api.github.com/gists/' + c.gistId + '?t=' + Date.now(), { headers: H, cache: 'no-store' });
        if (!r.ok) throw new Error('GET ' + r.status);
        const g = await r.json();
        const f = g.files && g.files['state.json'];
        let remote = emptyState();
        if (f) {
          let content = f.content;
          if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
          try { const box = JSON.parse(content); if (box && box.ct) remote = Object.assign(emptyState(), await decryptJSON(KEY, box)); } catch (e) { /* leer/ungültig */ }
        }
        const before = stateSig(STATE);
        const merged = mergeState(STATE, remote);
        const mSig = stateSig(merged);
        if (mSig !== before) { STATE = merged; localStorage.setItem(LS.state, JSON.stringify(STATE)); rerenderSoft(); }
        if (mSig !== stateSig(remote)) {
          const box = await encryptJSON(KEY, merged);
          const p = await fetch('https://api.github.com/gists/' + c.gistId, { method: 'PATCH', headers: Object.assign({ 'Content-Type': 'application/json' }, H), body: JSON.stringify({ files: { 'state.json': { content: JSON.stringify(box) } } }) });
          if (!p.ok) throw new Error('PATCH ' + p.status);
        }
        this.last = Date.now(); this.set('ok');
      } catch (e) { this.set('err', String(e.message || e)); }
      finally { this.busy = false; if (this.again) { this.again = false; this.schedule(300); } }
    },
    started: false,
    start() {
      if (!this.cfg()) { this.set('off'); return; }
      this.run();
      if (this.started) return;
      this.started = true;
      setInterval(() => { if (document.visibilityState === 'visible') this.run(); }, 45000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.run(); });
      window.addEventListener('online', () => this.run());
    }
  };
  window.__usaSync = Sync;
  function renderSyncPill() {
    const el = $('#syncpill'); if (!el) return;
    const s = Sync.status;
    const txt = s === 'off' ? 'Nur dieses Handy' : s === 'busy' ? 'Sync …' : s === 'ok' ? 'Synchron' : (Sync.error === 'offline' ? 'Offline' : 'Sync-Fehler');
    el.innerHTML = `<span class="sync-dot ${s}"></span>${txt}`;
  }

  /* ---------- Boot ---------- */
  async function fetchData() {
    try {
      const r = await fetch('data.enc.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json(); localStorage.setItem(LS.data, JSON.stringify(j)); return j;
    } catch (e) { const c = readJSON(LS.data, null); if (c) return c; throw e; }
  }
  function codeFromHash() { const m = location.hash.match(/k=([0-9A-Za-z-]+)/); return m ? m[1] : null; }

  let BOX = null, CODE = null, hiddenAt = 0, pinFails = 0, pinBlockedUntil = 0, started = false;
  let swReg = null, reloadPending = false;
  function setupSW() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => { swReg = r; r.update().catch(() => {}); }).catch(() => {});
    // Neue Version aktiv: gesperrt/noch nicht entsperrt -> sofort neu laden, sonst beim nächsten Sperren
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadPending) return;
      reloadPending = true;
      if (!TRIP) location.reload();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {}); });
  }
  const LOCK_AFTER_MS = 5 * 60 * 1000;

  async function boot() {
    setupSW();
    let box;
    try { box = await fetchData(); } catch (e) { $('#app').innerHTML = '<div class="boot"><p>Keine Verbindung und noch keine Offline-Kopie.<br>Bitte einmal mit Internet öffnen.</p></div>'; return; }
    BOX = box;
    const candidates = [codeFromHash(), localStorage.getItem(LS.code)].filter(Boolean);
    for (const c of candidates) { if (await checkCode(box, c)) return afterCode(); }
    showLock(box, candidates.length ? 'Der gespeicherte Code passt nicht (mehr).' : '');
  }
  // Prüft den Link-Code (Zustands-/Sync-Schlüssel, unverändert seit v1)
  async function checkCode(box, code) {
    try {
      const k = await deriveKey(code, box.salt, box.iter);
      if (box.check) { const r = await decryptJSON(k, box.check); if (!r || r.ok !== 'usa26') return false; }
      else { TRIP = await decryptJSON(k, box); } // Altformat ohne PIN
      KEY = k; CODE = normCode(code); localStorage.setItem(LS.code, CODE); return true;
    } catch (e) { return false; }
  }
  function afterCode() { if (BOX.check) showPin(); else start(); }
  function showLock(box, msg) {
    $('#app').innerHTML = `<div class="lock">${decoLA('pin-svg')}<div class="lock-in"><div class="lock-em">🌺</div><h1>USA & Hawaii 2026</h1>
      <p style="opacity:.92;margin:0 0 18px">Privater Reisebegleiter. Bitte den Zugangscode eingeben (steht in der geteilten Nachricht).</p>
      <input id="code" class="inp" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" inputmode="text">
      <button id="unlock" class="btn block">Weiter</button>${msg ? `<div class="err">${esc(msg)}</div>` : ''}<div id="lockerr"></div></div></div>`;
    const go = async () => {
      const b = $('#unlock'); b.disabled = true; b.textContent = 'Prüfe …';
      if (await checkCode(box, $('#code').value)) afterCode();
      else { b.disabled = false; b.textContent = 'Weiter'; $('#lockerr').innerHTML = '<div class="err">Code stimmt nicht. Bitte nochmal prüfen.</div>'; }
    };
    $('#unlock').onclick = go; $('#code').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }

  /* ---------- PIN-Sperre ---------- */
  function wipeUi() {
    TRIP = null;
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    const f = $('#fab'); if (f) f.remove();
    $('#sheet-root').innerHTML = '';
    $('#toast').classList.remove('on');
  }
  function lockNow() { if (!BOX || !BOX.check || !CODE) return; wipeUi(); if (reloadPending) { location.reload(); return; } showPin(); }
  function showPin() {
    wipeUi();
    let pin = '', busy = false;
    const n = BOX.pin || 4;
    const KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ']];
    $('#app').innerHTML = `<div class="pin">${decoLA('pin-svg')}<div class="pin-top"><div class="pin-brand">USA &amp; Hawaii 2026</div><div class="pin-ico">${icon('lock')}</div><div class="pin-title">PIN eingeben</div>
      <div class="pin-sub" id="pinSub">Los Angeles · Honolulu</div>
      <div class="pin-dots" id="pinDots">${'<i></i>'.repeat(n)}</div></div>
      <div class="pin-pad">${KEYS.map(([d, l]) => `<button class="pk" data-d="${d}"><span class="pd">${d}</span><span class="pl">${l}</span></button>`).join('')}
        <span></span><button class="pk" data-d="0"><span class="pd">0</span><span class="pl"></span></button><button class="pk txt" id="pinDel" aria-label="Löschen">Löschen</button></div>
      <button class="pin-other" id="pinOther">Anderer Zugangscode?</button></div>`;
    const dots = $('#pinDots'), sub = $('#pinSub'), del = $('#pinDel');
    const paint = () => { dots.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < pin.length)); del.textContent = pin.length ? 'Löschen' : ''; };
    const msg = (t, err) => { sub.textContent = t; sub.classList.toggle('err', !!err); };
    const blocked = () => { const w = Math.ceil((pinBlockedUntil - Date.now()) / 1000); if (w > 0) { msg(`Zu viele Versuche – bitte ${w} s warten`, true); return true; } return false; };
    const tryPin = async () => {
      busy = true; dots.classList.add('busy');
      let ok = false;
      try { const dk = await deriveDataKey(CODE, pin, BOX.salt, BOX.iter); TRIP = await decryptJSON(dk, BOX); ok = true; } catch (e) { ok = false; }
      dots.classList.remove('busy'); busy = false;
      if (ok) { pinFails = 0; hiddenAt = 0; unlocked(); return; }
      pinFails++; pin = '';
      if (pinFails >= 5) pinBlockedUntil = Date.now() + 30000 * (pinFails - 4);
      dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
      if (navigator.vibrate) navigator.vibrate(120);
      paint(); if (!blocked()) msg('Falsche PIN – bitte nochmal', true);
    };
    const press = (d) => {
      if (busy || blocked()) return;
      if (d === 'del') { pin = pin.slice(0, -1); paint(); return; }
      if (pin.length >= n) return;
      pin += d; paint();
      if (pin.length === n) setTimeout(tryPin, 120);
    };
    $('#app').querySelectorAll('.pk[data-d]').forEach((b) => b.addEventListener('click', () => press(b.dataset.d)));
    del.onclick = () => press('del');
    $('#pinOther').onclick = () => { if (confirm('Zugangscode auf diesem Gerät vergessen und neu eingeben?')) { localStorage.removeItem(LS.code); CODE = null; KEY = null; showLock(BOX, ''); } };
    document.onkeydown = (e) => { if (!$('.pin')) return; if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
    paint(); blocked();
  }
  function unlocked() {
    document.onkeydown = null;
    if (!started) start(); else { renderShell(); Sync.start(); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); document.body.classList.add('veil'); }
    else {
      document.body.classList.remove('veil');
      if (TRIP && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) lockNow();
      hiddenAt = 0;
    }
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted && TRIP) lockNow(); });

  function start() {
    started = true;
    loadState();
    // Vorbelegte Häkchen aus den Daten (nur wenn noch nie gesetzt)
    TRIP.checklist.forEach((g) => g.items.forEach((it) => { if (it.done && !STATE.checks[it.id]) STATE.checks[it.id] = { d: true, t: 1, by: 'Daten' }; }));
    saveState(false);
    renderShell();
    Sync.start();
    setInterval(() => { if (TRIP && prefs.tab === 'heute' && !$('.sheet')) renderTab(); }, 30000);
  }

  /* ---------- Design: Themes, Icons, Deko (alles inline, offline) ---------- */
  const ICO = {
    heute: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.1M12 19.3v2.1M4.7 4.7l1.5 1.5M17.8 17.8l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.7 19.3l1.5-1.5M17.8 6.2l1.5-1.5"/>',
    plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.6"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.3" cy="14.3" r="1.05" fill="currentColor" stroke="none"/><circle cx="12" cy="14.3" r="1.05" fill="currentColor" stroke="none"/>',
    fahrten: '<path d="M5.2 11.6 7 7a2.2 2.2 0 0 1 2-1.4h6a2.2 2.2 0 0 1 2 1.4l1.8 4.6"/><rect x="3.5" y="11.5" width="17" height="6.2" rx="2.6"/><path d="M6.2 17.7v1.8M17.8 17.7v1.8"/><circle cx="7.6" cy="14.6" r="1.1" fill="currentColor" stroke="none"/><circle cx="16.4" cy="14.6" r="1.1" fill="currentColor" stroke="none"/>',
    karte: '<path d="M9 4.6 3.6 6.5v13l5.4-1.9 6 1.9 5.4-1.9v-13L15 6.5z"/><path d="M9 4.6v13M15 6.5v13"/>',
    liste: '<rect x="4" y="3.5" width="16" height="17" rx="3.6"/><path d="m7.8 9.1 1.6 1.6 2.9-2.9M7.8 15.1l1.6 1.6 2.9-2.9M14.6 9.4h2.6M14.6 15.4h2.6"/>',
    budget: '<path d="M4 7.6A2.6 2.6 0 0 1 6.6 5h10.8A2.6 2.6 0 0 1 20 7.6v8.8a2.6 2.6 0 0 1-2.6 2.6H6.6A2.6 2.6 0 0 1 4 16.4z"/><path d="M20 9.8h-3.8a2.2 2.2 0 0 0 0 4.4H20"/><circle cx="16.4" cy="12" r=".95" fill="currentColor" stroke="none"/>',
    infos: '<path d="M4 7.2A2.2 2.2 0 0 1 6.2 5h11.6A2.2 2.2 0 0 1 20 7.2v2.3a2.5 2.5 0 0 0 0 5v2.3a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.8v-2.3a2.5 2.5 0 0 0 0-5z"/><path d="M14.3 5.2v2M14.3 11v2M14.3 16.8v2"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    nav: '<path d="M20 4 4 10.8l6.6 2.6 2.6 6.6z"/>',
    route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
    car: '<path d="M5.2 11.6 7 7a2.2 2.2 0 0 1 2-1.4h6a2.2 2.2 0 0 1 2 1.4l1.8 4.6"/><rect x="3.5" y="11.5" width="17" height="6.2" rx="2.6"/><path d="M6.2 17.7v1.8M17.8 17.7v1.8"/>'
  };
  const icon = (k, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k] || ''}</svg>`;
  // Palme: Stamm + Wedel (eigene Zeichnung)
  function palm(x, y, h, s) {
    const top = y - h, bend = h * 0.14;
    const leaf = 'M0 0C-9-9-25-11-40 1C-33-1-28 0-24 3C-17-1-9-1 0 2Z';
    const angles = [-28, 8, 44, 82, 118, 152, 188, 214];
    return `<path d="M${x - 3 * s} ${y}C${x - 1 * s} ${y - h * 0.4} ${x + bend - 2 * s} ${y - h * 0.75} ${x + bend} ${top}L${x + bend + 3.2 * s} ${top + 1}C${x + bend + 1 * s} ${y - h * 0.75} ${x + 2 * s} ${y - h * 0.4} ${x + 2.4 * s} ${y}Z"/>` +
      angles.map((a, i) => `<path transform="translate(${x + bend + 1.5 * s} ${top}) rotate(${a}) scale(${s * (i % 2 ? 0.86 : 1)} ${s * (a > 90 && a < 270 ? -1 : 1) * (i % 2 ? 0.86 : 1)})" d="${leaf}"/>`).join('');
  }
  let decoN = 0;
  function decoLA(cls) {
    const u = 'd' + (++decoN);
    const stripes = [0, 1, 2, 3, 4].map((i) => `<rect x="0" y="${96 + i * 7}" width="400" height="${1.4 + i * 0.9}" fill="#000"/>`).join('');
    return `<svg class="deco ${cls || ''}" viewBox="0 0 400 160" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <defs><linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE29A"/><stop offset=".55" stop-color="#FFB15E"/><stop offset="1" stop-color="#FF6F7D"/></linearGradient>
      <mask id="${u}m"><rect width="400" height="160" fill="#fff"/>${stripes}</mask></defs>
      <circle cx="300" cy="112" r="50" fill="url(#${u}s)" mask="url(#${u}m)" opacity=".95"/>
      <path d="M0 140C60 128 110 134 170 126S300 120 400 132V160H0Z" fill="rgba(40,10,60,.30)"/>
      <g fill="rgba(30,8,45,.62)">${palm(232, 160, 104, 1)}${palm(268, 160, 78, .8)}${palm(372, 160, 120, 1.1)}</g></svg>`;
  }
  function hibiscus(cx, cy, r, rot) {
    const petals = [0, 72, 144, 216, 288].map((a) => `<ellipse cx="${cx}" cy="${cy - r * 0.62}" rx="${r * 0.5}" ry="${r * 0.66}" transform="rotate(${a + rot} ${cx} ${cy})"/>`).join('');
    return `<g fill="#FF6B95" opacity=".92">${petals}</g><circle cx="${cx}" cy="${cy}" r="${r * 0.2}" fill="#C2185B"/>
      <path d="M${cx} ${cy}l${r * 0.55} ${-r * 0.7}" stroke="#FFD166" stroke-width="${Math.max(1.4, r * 0.07)}" stroke-linecap="round"/><circle cx="${cx + r * 0.58}" cy="${cy - r * 0.74}" r="${r * 0.09}" fill="#FFD166"/>`;
  }
  function decoHNL(cls) {
    return `<svg class="deco ${cls || ''}" viewBox="0 0 400 160" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <circle cx="${cls === 'hero-svg' ? 330 : 318}" cy="${cls === 'hero-svg' ? 92 : 58}" r="30" fill="rgba(255,236,170,.5)"/>
      <g class="hib">${cls === 'hero-svg' ? hibiscus(366, 88, 24, 12) + hibiscus(318, 104, 12, -20) : hibiscus(352, 44, 26, 12) + hibiscus(300, 30, 13, -20)}</g>
      <path d="M0 118C40 106 70 106 110 118S180 130 220 118 290 104 330 116 380 128 400 120V160H0Z" fill="rgba(255,255,255,.18)"/>
      <path d="M0 132C35 122 65 124 100 134S170 144 210 132 280 120 320 131 375 142 400 136V160H0Z" fill="rgba(255,255,255,.22)"/>
      <path d="M0 146C40 138 75 140 110 148S180 156 220 147 290 138 330 146 380 154 400 150V160H0Z" fill="rgba(255,255,255,.30)"/></svg>`;
  }
  const themeOf = (dKey) => ((dayByDate(dKey) || {}).region === 'hnl' ? 'hnl' : 'la');
  function applyTheme() {
    const th = tripPhase() === 'during' ? themeOf(todayKey()) : 'la';
    if (document.body.dataset.theme !== th) document.body.dataset.theme = th;
    const mc = document.querySelector('meta[name="theme-color"]'); if (mc) mc.setAttribute('content', th === 'hnl' ? '#0B4F8A' : '#5B2BB0');
  }
  function heroPlace(day) {
    const r = day.region;
    if (r === 'hnl') return day.tz === 'Pacific/Honolulu' ? 'Honolulu · Waikīkī' : 'Los Angeles ✈ Honolulu';
    if (r === 'la') return 'Los Angeles';
    return day.date === TRIP.meta.start ? 'Frankfurt ✈ Los Angeles' : 'Los Angeles ✈ Frankfurt';
  }

  /* ---------- Shell ---------- */
  const TABS = [['heute', '☀️', 'Heute'], ['plan', '🗓️', 'Plan'], ['fahrten', '🚗', 'Fahrten'], ['karte', '🗺️', 'Karte'], ['liste', '✅', 'Liste'], ['budget', '💵', 'Budget'], ['infos', '🎫', 'Infos']];
  function renderShell() {
    $('#app').innerHTML = `<div class="sky" aria-hidden="true"><div class="sky-deco"></div></div>
      <header class="hdr"><div class="hdr-row"><div class="hdr-s" id="htitleS" aria-hidden="true"></div><button id="syncpill" class="sync-pill" aria-label="Sync-Status"></button></div></header>
      <div class="lt"><h1 id="htitle"></h1><div class="sub" id="hsub"></div></div>
      <main id="main"></main>
      <nav class="tabs">${TABS.map(([id, , l]) => `<button class="tab" data-tab="${id}" aria-label="${l}"><span class="ico">${icon(id)}</span><span class="tl-l">${l}</span></button>`).join('')}</nav>`;
    document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => { prefs.tab = b.dataset.tab; savePrefs(); renderTab(); window.scrollTo(0, 0); }));
    $('#syncpill').onclick = () => { if (Sync.cfg()) { Sync.run(); toast(Sync.status === 'err' ? 'Sync-Fehler: ' + Sync.error : 'Synchronisiere …'); } else toast('Sync ist nicht eingerichtet – Daten nur auf diesem Handy.'); };
    renderSyncPill();
    renderTab();
  }
  let lastTab = null;
  window.addEventListener('scroll', () => { const on = window.scrollY > 46; if (document.body.classList.contains('scrolled') !== on) document.body.classList.toggle('scrolled', on); }, { passive: true });
  function rerenderSoft() { if (TRIP && $('#main') && !$('.sheet') && prefs.tab !== 'karte') renderTab(); }
  function renderTab() {
    if (!TRIP || !$('#main')) return;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === prefs.tab));
    const titles = { heute: TRIP.meta.title, plan: 'Reiseplan', fahrten: 'Fahrten', karte: 'Route', liste: 'Checkliste', budget: 'Budget', infos: 'Buchungen & Infos' };
    applyTheme();
    $('#htitle').textContent = titles[prefs.tab]; $('#htitleS').textContent = titles[prefs.tab];
    $('#hsub').textContent = TRIP.meta.subtitle;
    const sd = $('.sky-deco'); const th = document.body.dataset.theme;
    if (sd && sd.dataset.th !== th) { sd.innerHTML = th === 'hnl' ? decoHNL('sky-svg') : decoLA('sky-svg'); sd.dataset.th = th; }
    const m = $('#main');
    if (lastTab !== prefs.tab) { lastTab = prefs.tab; m.classList.remove('enter'); void m.offsetWidth; m.classList.add('enter'); }
    if (prefs.tab !== 'karte' && map) { map.remove(); map = null; }
    ({ heute: viewHeute, plan: viewPlan, fahrten: viewFahrten, karte: viewKarte, liste: viewListe, budget: viewBudget, infos: viewInfos }[prefs.tab] || viewHeute)(m);
    const fab = prefs.tab === 'budget' || prefs.tab === 'heute';
    let f = $('#fab'); if (f) f.remove();
    if (fab) { f = document.createElement('button'); f.id = 'fab'; f.className = 'fab'; f.textContent = '＋ Ausgabe'; f.onclick = () => expenseSheet(); document.body.appendChild(f); }
  }

  /* ---------- Hilfen Reise ---------- */
  const dayByDate = (d) => TRIP.days.find((x) => x.date === d);
  function evTs(day, ev) { return zoned(day.date, ev.time, ev.tz || day.tz); }
  function sortedEvents(day) { return day.events.map((e) => Object.assign({ _ts: evTs(day, e) }, e)).sort((a, b) => a._ts - b._ts); }
  function todayKey() { return dateIn(deviceTz(), Date.now()); }
  function tripPhase() { const t = todayKey(); if (t < TRIP.meta.start) return 'before'; if (t > TRIP.meta.end) return 'after'; return 'during'; }
  function currentDay() { const t = todayKey(); return dayByDate(t) ? t : (t < TRIP.meta.start ? TRIP.meta.start : TRIP.meta.end); }
  function evTimeHtml(day, e) {
    const tz = e.tz || day.tz, ts = e._ts || evTs(day, e);
    let t2 = '';
    if (tz !== BERLIN) {
      const bd = dateIn(BERLIN, ts), ld = dateIn(tz, ts);
      t2 = `<div class="t2">${hm(BERLIN, ts)} Berlin${bd !== ld ? (bd > ld ? ' +1' : ' −1') : ''}</div>`;
    } else if (deviceTz() !== BERLIN && TZ_LABEL[deviceTz()]) {
      t2 = `<div class="t2">${hm(deviceTz(), ts)} ${TZ_LABEL[deviceTz()]}</div>`;
    }
    return `<div class="t1">${esc(e.time)}</div><div class="tz">${TZ_LABEL[tz] || tz}</div>${t2}`;
  }
  function timelineHtml(day, live) {
    const evs = sortedEvents(day), now = Date.now();
    let nextIdx = -1;
    if (live) nextIdx = evs.findIndex((e) => e._ts > now);
    return `<div class="tl">${evs.map((e, i) => {
      const past = live && e._ts < now && i !== nextIdx;
      const tids = evTripIds(e);
      const cls = [e.type || '', past ? 'past' : '', i === nextIdx ? 'next' : '', tids.length ? 'has-trip' : ''].join(' ');
      return `<div class="ev ${cls}"${tids.length ? ` data-trip="${esc(tids.join(','))}" role="button" tabindex="0" aria-label="Route öffnen: ${esc(e.title)}"` : ''}><div class="tcol">${evTimeHtml(day, e)}</div><div class="dot">${TYPE_ICON[e.type] || '•'}</div>
        <div class="body"><div class="ttl">${esc(e.title)}${i === nextIdx ? '<span class="badge">ALS NÄCHSTES</span>' : ''}</div>${e.detail ? `<div class="det">${esc(e.detail)}</div>` : ''}${tids.length ? `<div class="route-hint">🧭 Route öffnen${tids.length > 1 ? ` (${tids.length})` : ''} ›</div>` : ''}</div></div>`;
    }).join('')}</div>`;
  }

  // Plan-Eintrag → Fahrten (tripIds in trip.json)
  function evTripIds(e) { const ids = e.tripIds || (e.tripId ? [e.tripId] : []); return ids.filter((id) => (TRIP.trips || []).some((t) => t.id === id)); }
  function bindEvTrips(root) {
    root.querySelectorAll('.ev[data-trip]').forEach((el) => {
      const go = () => routeSheet(el.dataset.trip.split(','));
      el.onclick = (ev) => { if (ev.target.closest('a')) return; go(); };
      el.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } };
    });
  }
  function routeSheet(ids) {
    const trips = ids.map((id) => allTrips().find((t) => t.id === id)).filter(Boolean);
    if (!trips.length) return;
    let here = false;
    const body = () => trips.map((t) => {
      const f = tripPlace(t.from), to = tripPlace(t.to);
      return `<div class="rs-trip"><div class="rs-h"><b>${esc(t.timeLabel || t.time || '')}</b> <span class="chip ${t.mode === 'driving' ? '' : 'teal'}">${t.icon || MODES[t.mode].ico} ${esc(t.how || MODES[t.mode].label)}</span></div>
        <div class="rs-ft">${here ? '📍 Mein Standort' : esc(cleanName(f))} → <b>${esc(cleanName(to))}</b></div>${t.dur ? `<div class="tiny muted">⏱ ${esc(t.dur)}</div>` : ''}${compareHtml(t)}${btnSet(t, here)}</div>`;
    }).join('');
    openSheet(`<h2 style="margin:4px 0 10px">🧭 Route öffnen</h2><div id="rsBody">${body()}</div>
      <button class="tg" id="rsHere" aria-pressed="false">📍 Ab meinem Standort</button>
      <button class="btn sec block" id="rsCancel">Abbrechen</button>`, (sh, close) => {
      const bindLinks = () => sh.querySelectorAll('.mapbtn, .ridebtn').forEach((a) => a.addEventListener('click', () => setTimeout(close, 300)));
      bindLinks();
      $('#rsHere', sh).onclick = (ev) => {
        here = !here; const b = ev.currentTarget;
        b.classList.toggle('on', here); b.setAttribute('aria-pressed', String(here)); b.textContent = (here ? '✓ ' : '') + '📍 Ab meinem Standort';
        $('#rsBody', sh).innerHTML = body(); bindLinks();
      };
      $('#rsCancel', sh).onclick = close;
    });
  }

  /* ---------- Heute ---------- */
  function viewHeute(m) {
    const phase = tripPhase();
    const dKey = viewDay || currentDay();
    const day = dayByDate(dKey);
    const idx = TRIP.days.indexOf(day);
    const isToday = dKey === todayKey();
    const now = Date.now();
    const clocks = [['America/Los_Angeles', 'Los Angeles'], ['Pacific/Honolulu', 'Honolulu'], [BERLIN, 'Berlin']];
    let html = '';
    if (isIOS() && !isStandalone() && !prefs.hideA2HS) {
      html += `<div class="banner">📲 <b>Tipp:</b> Als App auf den Home-Bildschirm legen – dann geht's auch offline. <a href="#" id="a2hs">So geht's</a> · <a href="#" id="a2hsx">ausblenden</a></div>`;
    }
    if (phase === 'before') {
      const n = dayDiff(todayKey(), TRIP.meta.start);
      const open = openImportant();
      html += `<section class="hero countdown t-la">${decoLA('hero-svg')}
        <div class="hero-top"><span class="hero-loc">${icon('nav')} FRA → LAX</span><span class="hero-clock">${icon('clock')}<b>${hm(BERLIN, now)}</b> Berlin</span></div>
        <div class="kicker">Countdown</div>
        <div class="cd"><div class="cd-num">${n}</div><div class="cd-txt"><div class="cd-t">Noch ${n} ${n === 1 ? 'Tag' : 'Tage'}<br>bis LA ✈️</div></div></div>
        <div class="sub">bis zum Abflug am Fr 09.10. um 10:40 (FRA)</div></section>
        <div class="card">${open.length ? `<div class="note-warn" style="margin-top:0">⚠️ ${open.length} wichtige Punkte noch offen: ${open.slice(0, 3).map((i) => esc(i.text)).join(' · ')}${open.length > 3 ? ' …' : ''}</div><button class="btn sec block" id="goList">Zur Checkliste</button>` : '<div class="small">✅ Alle wichtigen Punkte erledigt!</div>'}</div>`;
    } else if (phase === 'after') {
      html += `<div class="card"><h2>Willkommen zurück! 🏠</h2><div class="small muted">Die Reise ist vorbei. Ausgaben stehen im Budget-Tab.</div></div>`;
    }
    const th = themeOf(dKey);
    const heroHtml = `<section class="hero t-${th}">${th === 'hnl' ? decoHNL('hero-svg') : decoLA('hero-svg')}
      <div class="hero-top"><span class="hero-loc">${icon('pin')} ${esc(heroPlace(day))}</span><span class="hero-clock">${icon('clock')}<b>${hm(day.tz, now)}</b> ${esc(TZ_LABEL[day.tz] || '')}</span></div>
      <div class="kicker">${isToday ? 'Heute · ' : ''}Tag ${idx + 1} von ${TRIP.days.length}</div>
      <h2><span class="hero-em">${day.emoji || ''}</span>${esc(day.title)}</h2><div class="sub">${fmtDate(day.date, true)} · ${esc(day.subtitle || '')}</div>
      <div class="daynav"><button id="dprev" ${idx === 0 ? 'disabled' : ''}>‹ Vortag</button>${!isToday && dayByDate(todayKey()) ? '<button id="dtoday">Heute</button>' : ''}<button id="dnext" ${idx === TRIP.days.length - 1 ? 'disabled' : ''}>Nächster ›</button></div></section>`;
    if (phase !== 'before') html += heroHtml;
    html += `<div class="clocks">${clocks.map(([tz, l]) => `<div class="clock ${deviceTz() === tz ? 'here' : ''}"><div class="t">${hm(tz, now)}</div><div class="l">${l}</div></div>`).join('')}</div>`;
    if (phase === 'before') html += heroHtml;
    html += `<div class="card"><h2>${icon('plan', 'h-i')}Tagesplan</h2>${timelineHtml(day, isToday)}<div class="tiny muted" style="margin-top:6px">Zeiten in Ortszeit, darunter Berliner Zeit.</div></div>`;
    html += tripsMiniCard(dKey);
    // Budget heute
    const b = dayBudget(dKey);
    const roll = rolloverBefore(dKey);
    html += `<div class="card"><div class="row"><h2 class="grow" style="margin:0">Budget ${isToday ? 'heute' : fmtDate(dKey)}</h2><span class="chip teal">${prefs.budgetMode === 'ziel' ? 'Ziel' : 'Plan'}</span></div>
      <div class="kpis" style="margin-top:10px"><div class="kpi"><div class="v">${eur(b.planned)}</div><div class="l">geplant (≈ ${usd(b.planned * fx())})</div></div>
      <div class="kpi teal"><div class="v ${b.spent > b.planned ? 'neg' : ''}">${eur(b.spent)}</div><div class="l">ausgegeben</div></div></div>
      <div class="bar ${b.spent > b.planned ? 'over' : ''}" style="margin-top:10px"><i style="width:${Math.min(100, b.planned ? (b.spent / b.planned) * 100 : 0)}%"></i></div>
      <div class="small" style="margin-top:8px">${b.planned - b.spent >= 0 ? `Noch <b class="pos">${eur(b.planned - b.spent)}</b> übrig` : `<b class="neg">${eur(b.spent - b.planned)}</b> über Tagesbudget`}${dKey >= TRIP.meta.start && Math.abs(roll) >= 1 ? ` · Bisher ${roll >= 0 ? `<span class="pos">${eur(roll)} gespart</span>` : `<span class="neg">${eur(-roll)} drüber</span>`}` : ''}</div></div>`;
    // relevante Buchung
    const bks = [...new Set(day.events.map((e) => e.booking).filter(Boolean))];
    if (bks.length) html += `<div class="sec-title">Buchungen für diesen Tag</div>` + bks.map((id) => bookingCard(TRIP.bookings.find((x) => x.id === id), true)).join('');
    m.innerHTML = html;
    const nav = (d) => { viewDay = d; renderTab(); window.scrollTo(0, 0); };
    $('#dprev') && ($('#dprev').onclick = () => nav(TRIP.days[idx - 1].date));
    $('#dnext') && ($('#dnext').onclick = () => nav(TRIP.days[idx + 1].date));
    $('#dtoday') && ($('#dtoday').onclick = () => nav(null));
    $('#goList') && ($('#goList').onclick = () => { prefs.tab = 'liste'; savePrefs(); renderTab(); });
    m.querySelectorAll('[data-trips]').forEach((b) => (b.onclick = () => openTrips(b.dataset.trips)));
    bindEvTrips(m);
    $('#a2hs') && ($('#a2hs').onclick = (e) => { e.preventDefault(); a2hsSheet(); });
    $('#a2hsx') && ($('#a2hsx').onclick = (e) => { e.preventDefault(); prefs.hideA2HS = true; savePrefs(); renderTab(); });
    bindCopy(m);
  }

  /* ---------- Plan ---------- */
  function viewPlan(m) {
    const t = todayKey();
    m.innerHTML = TRIP.days.map((d, i) => `<div class="card day r-${esc(d.region || 'fra')} ${d.date === t ? 'today open' : ''}" data-d="${d.date}">
      <button class="day-h"><div class="em">${d.emoji}</div><div class="grow"><div class="d">Tag ${i + 1} · ${fmtDate(d.date)}${d.date === t ? ' · heute' : ''}</div><div class="tt">${esc(d.title)}</div><div class="small muted">${esc(d.subtitle || '')}</div></div><div class="chev">›</div></button>
      <div class="day-b">${timelineHtml(d, d.date === t)}<div class="row wrap"><button class="btn ghost" data-open="${d.date}">In „Heute“ öffnen ›</button>${tripsOn(d.date).length ? `<button class="btn ghost" data-trips="${d.date}">🚗 Fahrten (${tripsOn(d.date).length}) ›</button>` : ''}</div></div></div>`).join('') +
      `<div class="card"><h3>💡 Gut zu wissen</h3><ul class="lines">${(TRIP.tips || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    m.querySelectorAll('.day-h').forEach((b) => (b.onclick = () => b.parentElement.classList.toggle('open')));
    m.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { viewDay = b.dataset.open; prefs.tab = 'heute'; savePrefs(); renderTab(); window.scrollTo(0, 0); }));
    m.querySelectorAll('[data-trips]').forEach((b) => (b.onclick = () => openTrips(b.dataset.trips)));
    bindEvTrips(m);
  }

  /* ---------- Fahrten ---------- */
  const MODES = { driving: { apple: 'd', label: 'Auto', ico: '🚗' }, transit: { apple: 'r', label: 'ÖPNV', ico: '🚌' }, walking: { apple: 'w', label: 'zu Fuß', ico: '🚶' } };
  function allTrips() { return (TRIP.trips || []).filter((t) => MODES[t.mode]); }
  function tripTs(t) { return t.date && t.time ? zoned(t.date, t.time, t.tz || (dayByDate(t.date) || {}).tz || BERLIN) : null; }
  function tripsOn(date) { return allTrips().filter((t) => t.date === date).map((t) => Object.assign({ _ts: tripTs(t) }, t)).sort((a, b) => a._ts - b._ts); }
  function tripPlace(x) {
    if (typeof x === 'string') { const p = TRIP.places[x]; return p ? Object.assign({ id: x }, p) : { name: x }; }
    return x || {};
  }
  const cleanName = (p) => String(p.name || '').split(' (')[0];
  // Suchtext für die Karten-Apps: lieber Name + Adresse als Koordinaten (zeigt richtige Namen)
  function placeQuery(p) {
    if (p.q) return p.q;
    const n = cleanName(p);
    if (p.address) return n && !p.address.toLowerCase().startsWith(n.toLowerCase()) ? n + ', ' + p.address : p.address;
    return n || (p.lat + ',' + p.lng);
  }
  function tripLinks(t, here) {
    const md = MODES[t.mode], o = placeQuery(tripPlace(t.from)), d = placeQuery(tripPlace(t.to));
    const via = (t.via || []).map((v) => placeQuery(tripPlace(v)));
    const e = encodeURIComponent;
    let apple;
    if (via.length) apple = 'https://maps.apple.com/directions?' + (here ? '' : 'source=' + e(o) + '&') + 'destination=' + e(d) + via.map((v) => '&waypoint=' + e(v)).join('') + '&mode=' + t.mode;
    else apple = 'https://maps.apple.com/?' + (here ? '' : 'saddr=' + e(o) + '&') + 'daddr=' + e(d) + '&dirflg=' + md.apple;
    const google = 'https://www.google.com/maps/dir/?api=1' + (here ? '' : '&origin=' + e(o)) + '&destination=' + e(d) + (via.length ? '&waypoints=' + via.map(e).join('%7C') : '') + '&travelmode=' + t.mode;
    return { apple, google };
  }
  // Uber: offizieller Universal Link (developer.uber.com, action=setPickup); Ziel braucht nickname/formatted_address
  function uberLink(t, here) {
    const e = encodeURIComponent, f = tripPlace(t.from), to = tripPlace(t.to);
    const loc = (k, p) => (p.lat != null ? `&${k}[latitude]=${p.lat}&${k}[longitude]=${p.lng}` : '') + `&${k}[nickname]=${e(cleanName(p))}&${k}[formatted_address]=${e(p.address || placeQuery(p))}`;
    return 'https://m.uber.com/ul/?action=setPickup' + (here ? '&pickup=my_location' : loc('pickup', f)) + loc('dropoff', to);
  }
  // SIXT ride: kein offizieller Deep Link. Die SIXT-ride-Webbuchung liest aber pickup/destination (Google Place IDs) +
  // datetime (ms, wird als Uhrzeit im Gerät-Zeitformat gelesen) aus der URL – in Headless-Chrome geprüft (03.10.2026).
  const RI = () => TRIP.rideInfo || {};
  const SIXT_LEAD = 45 * 60 * 1000;
  function sixtTime(t) {
    const to = tripPlace(t.to);
    const tz = t.tz || (dayByDate(t.date) || {}).tz || (to.lng < -150 ? 'Pacific/Honolulu' : 'America/Los_Angeles');
    const now = Date.now(); let ts = tripTs(t);
    if (!ts || ts < now + SIXT_LEAD) ts = Math.ceil((now + SIXT_LEAD) / 300000) * 300000;
    const q = partsIn(tz, ts);
    return new Date(+q.year, +q.month - 1, +q.day, (+q.hour) % 24, +q.minute).getTime();
  }
  function sixtRideUrl(t, here) {
    const f = tripPlace(t.from), to = tripPlace(t.to);
    if (!to.sixtPid || (!here && !f.sixtPid)) return RI().sixtUrl || 'https://www.sixt.de/ride/';
    return (RI().sixtFunnel || 'https://www.sixt.de/ride/betafunnel/#/offers') + '?' + (here ? '' : 'pickup=' + encodeURIComponent(f.sixtPid) + '&') +
      'destination=' + encodeURIComponent(to.sixtPid) + '&type=DISTANCE&datetime=' + sixtTime(t);
  }
  function rideBtns(t, here) {
    const to = tripPlace(t.to), pre = !!to.sixtPid;
    const sixtTxt = !pre ? 'SIXT ride: Start/Ziel in der App eingeben – Zieladresse wird beim Tippen kopiert.'
      : here ? 'SIXT ride: Ziel + Uhrzeit vorausgefüllt (Webbuchung mit Preisen) – Abholort unter „Suche ändern“ eingeben.'
      : 'SIXT ride: Start, Ziel + Uhrzeit vorausgefüllt (Webbuchung mit Preisen).';
    return `<div class="ridebtns"><a class="ridebtn uber" href="${esc(uberLink(t, here))}" target="_blank" rel="noopener">${icon('car', 'b-i')}Uber</a><a class="ridebtn sixt" href="${esc(sixtRideUrl(t, here))}" target="_blank" rel="noopener" data-trip="${esc(t.id)}"${pre ? '' : ` data-dest="${esc(to.address || placeQuery(to))}"`}>${icon('car', 'b-i')}SIXT ride</a></div>
      <div class="tiny muted ride-n">Uber: Start &amp; Ziel vorausgefüllt. ${sixtTxt}${pre ? ` Amex-Guthaben laut SIXT in der <a class="sixtapp" href="${esc(RI().sixtApp || 'https://www.sixt.de/ride')}" target="_blank" rel="noopener" data-dest="${esc(to.address || placeQuery(to))}">SIXT App</a> einlösen.` : ''}</div>`;
  }
  function btnSet(t, here) {
    const maps = mapBtns(t, here).replace(' data-links="' + esc(t.id) + '"', '');
    const ride = t.ride === false ? '' : rideBtns(t, here);
    return `<div class="btnset" data-links="${esc(t.id)}">${t.rideFirst ? ride + maps : maps + ride}</div>`;
  }
  function parkingOf(t) { return t.parking || tripPlace(t.to).parking || null; }
  function compareHtml(t) {
    if (t.ride === false) return t.rideNote ? `<div class="cmp tiny">${esc(t.rideNote)}</div>` : '';
    const amex = '<div class="cmp-amex">💳 Amex Platinum: SIXT-ride-Guthaben nutzen (vorab buchen, 1 × 25 € pro Fahrt)</div>';
    if (t.rideFirst) return `<div class="cmp tiny"><div>🚕 <b>Kein Mietwagen</b> – Uber oder SIXT ride: Preis in der App prüfen${t.mode === 'transit' ? ' (oder Bus wie geplant)' : ''}.</div>${amex}</div>`;
    if (t.mode !== 'driving') return '';
    const pk = parkingOf(t);
    const pkTxt = pk ? `${esc(pk.text)}${pk.src ? ` <span class="src">(${pk.url ? `<a href="${esc(pk.url)}" target="_blank" rel="noopener">${esc(pk.src)}</a>` : esc(pk.src)}${pk.unverified ? ', nicht offiziell bestätigt' : ''})</span>` : pk.unverified ? ' <span class="src">(nicht bestätigt)</span>' : ''}` : 'unbekannt';
    return `<div class="cmp tiny"><div>🅿️ <b>Parken am Ziel:</b> ${pkTxt}</div><div>🚗 Mietwagen ist bezahlt – zusätzlich nur Parken + Benzin. 🚕 <b>Uber/SIXT ride:</b> Preis in der App prüfen; lohnt sich, wenn die Fahrt weniger kostet als das Parken.</div>${amex}</div>`;
  }
  /* ---------- Auto & Parken ---------- */
  function driveEntry() {
    const d = TRIP.driving; if (!d) return '';
    return `<button class="card drive-entry" data-drive="1"><span class="de-ic">${icon('car')}</span><span class="grow"><b>${esc(d.title)}</b><span class="tiny muted">Bordsteine, Schilder, Parkuhren, Tanken, Maut, Panne</span></span><span class="chev">›</span></button>`;
  }
  function driveSheet(jump) {
    const d = TRIP.driving; if (!d) return;
    const item = (x) => `<li>${esc(x)}</li>`;
    const sec = (s, i) => `<details class="card dsec" id="ds-${esc(s.id)}"${(jump ? s.id === jump : i === 0) ? ' open' : ''}><summary><span class="ds-ic">${s.icon}</span><b>${esc(s.title)}</b><span class="chev">›</span></summary>
      <ul class="lines">${s.items.map(item).join('')}</ul>${s.note ? `<div class="note-warn small">${esc(s.note)}</div>` : ''}
      ${(s.actions || []).length ? `<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px">${s.actions.map(([l, n]) => `<a class="btn sec" href="tel:${esc(n)}">📞 ${esc(l)}</a>`).join('')}</div>` : ''}
      ${(s.src || []).length ? `<div class="tiny muted" style="margin-top:8px">Quelle: ${s.src.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join(' · ')}</div>` : ''}</details>`;
    openSheet(`<div class="row" style="align-items:center"><h2 class="grow" style="margin:4px 0">🚗 ${esc(d.title)}</h2><button class="btn ghost" id="dsClose">Schließen</button></div>
      <p class="small muted" style="margin:4px 0 10px">${esc(d.intro)}</p>
      <div class="ds-chips">${d.sections.map((s) => `<button class="chip" data-ds="${esc(s.id)}">${s.icon} ${esc(s.title)}</button>`).join('')}</div>
      ${d.sections.map(sec).join('')}<div class="tiny muted" style="margin:8px 4px 4px">Stand ${esc(d.updated || '')}. Angaben ohne Gewähr – Schilder vor Ort gehen vor.</div>`, (sh, close) => {
      $('#dsClose', sh).onclick = close;
      sh.querySelectorAll('[data-ds]').forEach((b) => (b.onclick = () => { const el = $('#ds-' + b.dataset.ds, sh); el.open = true; sh.scrollTo({ top: el.offsetTop - 12, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }));
      if (jump) { const el = $('#ds-' + jump, sh); if (el) sh.scrollTop = el.offsetTop - 12; }
    });
  }
  function bindDrive(root) { root.querySelectorAll('[data-drive]').forEach((b) => (b.onclick = () => driveSheet())); }
  function amexCard() {
    const a = TRIP.rideInfo && TRIP.rideInfo.amex; if (!a) return '';
    return `<details class="card amex"><summary><b>💳 ${esc(a.title)}</b> <span class="muted small">– Bedingungen</span></summary><ul class="lines">${a.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <div class="tiny muted">Quellen: ${a.sources.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)}</a>`).join(' · ')}</div></details>`;
  }
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a.ridebtn.sixt, a.sixtapp'); if (!a) return;
    if (a.classList.contains('ridebtn') && a.dataset.trip) { // Uhrzeit beim Tippen aktualisieren (nie in der Vergangenheit)
      const t = allTrips().find((x) => x.id === a.dataset.trip);
      if (t && /[?&]destination=/.test(a.href)) a.href = sixtRideUrl(t, !/[?&]pickup=/.test(a.href));
    }
    if (!a.dataset.dest) return;
    try { navigator.clipboard.writeText(a.dataset.dest).then(() => toast('Ziel kopiert – in SIXT ride einfügen'), () => {}); } catch (e) {}
  });

  // Nächste Fahrt: erste, deren Abfahrt höchstens 20 min her ist
  const TRIP_GRACE = 20 * 60 * 1000;
  function nextTripId() { const now = Date.now(); const n = allTrips().filter((t) => t.date).map((t) => ({ id: t.id, ts: tripTs(t) })).sort((a, b) => a.ts - b.ts).find((x) => x.ts + TRIP_GRACE > now); return n ? n.id : null; }
  function mapBtns(t, here, mini) {
    const L = tripLinks(t, here);
    return `<div class="mapbtns${mini ? ' mini' : ''}" data-links="${esc(t.id)}"><a class="mapbtn apple" href="${esc(L.apple)}" target="_blank" rel="noopener">${icon('nav', 'b-i')}${mini ? 'Apple' : 'Apple Karten'}</a><a class="mapbtn google" href="${esc(L.google)}" target="_blank" rel="noopener">${icon('route', 'b-i')}${mini ? 'Google' : 'Google Maps'}</a></div>`;
  }
  function tripCard(t, opts) {
    const f = tripPlace(t.from), to = tripPlace(t.to), here = !!tripsHere[t.id];
    const tz = t.tz || (dayByDate(t.date) || {}).tz;
    const reg = tz === 'Pacific/Honolulu' || (dayByDate(t.date) || {}).region === 'hnl' || (to.lng < -150) ? 'hnl' : 'la';
    const cls = ['card', 'trip', 'r-' + reg, opts.next ? 'next' : '', opts.past ? 'past' : ''].join(' ');
    let berlin = '';
    if (t.time && !t.timeLabel && tz && tz !== BERLIN) { const ts = tripTs(t), bd = dateIn(BERLIN, ts), ld = dateIn(tz, ts); berlin = `<span class="tz b">= ${hm(BERLIN, ts)} Berlin${bd !== ld ? (bd > ld ? ' +1' : ' −1') : ''}</span>`; }
    const timeTxt = t.timeLabel ? esc(t.timeLabel) : t.time ? `${esc(t.time)}<span class="tz">${esc(TZ_LABEL[tz] || '')}</span>${berlin}` : '';
    return `<div class="${cls}" id="trip-${esc(t.id)}">
      <div class="trip-h">${timeTxt ? `<div class="trip-t">${timeTxt}</div>` : ''}<span class="chip ${t.mode === 'driving' ? '' : 'teal'}">${t.icon || MODES[t.mode].ico} ${esc(t.how || MODES[t.mode].label)}</span>${t.idea ? '<span class="chip idea">Idee</span>' : ''}${opts.next ? '<span class="badge">ALS NÄCHSTES</span>' : ''}</div>
      <div class="ft"><div class="ft-p"><i class="ft-dot a"></i><div class="grow"><div class="ft-n">${esc(cleanName(f))}</div>${f.address ? `<div class="tiny muted">${esc(f.address)}</div>` : ''}</div></div>
        <div class="ft-p"><i class="ft-dot b"></i><div class="grow"><div class="ft-n">${esc(cleanName(to))}</div>${to.address ? `<div class="tiny muted">${esc(to.address)}</div>` : ''}</div></div></div>
      ${t.dur || t.note ? `<div class="small trip-n">${t.dur ? `<b>⏱ ${esc(t.dur)}</b>` : ''}${t.dur && t.note ? ' · ' : ''}${esc(t.note || '')}</div>` : ''}
      ${compareHtml(t)}
      <button class="tg ${here ? 'on' : ''}" data-here="${esc(t.id)}" aria-pressed="${here}">${here ? '✓ ' : ''}📍 Ab meinem Standort</button>
      ${btnSet(t, here)}</div>`;
  }
  function stayToday() {
    const t = todayKey();
    if (t >= '2026-10-09' && t <= '2026-10-12') return ['airbnb'];
    if (t >= '2026-10-13' && t <= '2026-10-18') return ['hotel'];
    return tripPhase() === 'during' ? [] : ['airbnb', 'hotel'];
  }
  function viewFahrten(m) {
    const phase = tripPhase(), tKey = todayKey(), now = Date.now();
    const nextId = phase === 'during' ? nextTripId() : null;
    const dated = allTrips().filter((t) => t.date), ideas = allTrips().filter((t) => !t.date);
    const days = [...new Set(dated.map((t) => t.date))].sort();
    let html = `<div class="card soft"><div class="small">Tippen öffnet die Route direkt in <b>Apple Karten</b> oder <b>Google Maps</b> – Auto in LA (Mietwagen), Bus/zu Fuß/Uber in Honolulu. Pläne verschoben? <b>📍 Ab meinem Standort</b> startet dort, wo ihr gerade seid.</div></div>`;
    html += driveEntry() + amexCard();
    const stays = stayToday();
    if (stays.length) {
      html += `<div class="card"><h3>🏠 Zurück zur Unterkunft <span class="muted small" style="font-weight:600">· ab meinem Standort</span></h3>` + stays.map((id) => {
        const p = TRIP.places[id], t = { id: 'home-' + id, from: id, to: id, mode: id === 'hotel' ? 'transit' : 'driving' };
        return `<div class="trow"><div class="grow"><div style="font-weight:700">${esc(cleanName(p))}</div><div class="tiny muted">${id === 'hotel' ? '🚌 Bus/zu Fuß · 13.–18.10.' : '🚗 Mietwagen · 09.–13.10.'}</div></div>${mapBtns(t, true, true)}</div>`;
      }).join('') + `</div>`;
    }
    days.forEach((d) => {
      const day = dayByDate(d), list = tripsOn(d), idx = TRIP.days.indexOf(day);
      const isT = d === tKey && phase === 'during';
      html += `<div class="sec-title ${isT ? 'today' : ''}" id="tday-${d}">${fmtDate(d, true)}${idx >= 0 ? ' · Tag ' + (idx + 1) : ''}${isT ? ' · heute' : ''}</div><div class="tgroup ${isT ? 'today' : ''}">`;
      html += list.map((t) => tripCard(t, { next: t.id === nextId, past: phase === 'during' && t._ts + TRIP_GRACE <= now && t.id !== nextId })).join('') + `</div>`;
    });
    if (ideas.length) html += `<div class="sec-title" id="tday-ideen">💡 Ausflugsideen (ohne festen Termin)</div>` + ideas.map((t) => tripCard(t, {})).join('');
    html += `<div class="tiny muted" style="text-align:center;margin-top:6px">Zeiten = geplante Abfahrt in Ortszeit. Routen/Dauer liefert die Karten-App live.</div>`;
    m.innerHTML = html;
    bindTripBtns(m); bindDrive(m);
    // Springen: gewünschter Tag, sonst nächste Fahrt (während der Reise)
    const nextT = nextId && allTrips().find((t) => t.id === nextId);
    const target = tripsFocus && !(nextT && nextT.date === tripsFocus) ? $('#tday-' + tripsFocus) : nextId ? $('#trip-' + nextId) : null;
    tripsFocus = null;
    if (target) setTimeout(() => { const y = target.getBoundingClientRect().top + window.scrollY - ($('.hdr') ? $('.hdr').offsetHeight : 0) - 10; window.scrollTo(0, Math.max(0, y)); }, 30);
  }
  function bindTripBtns(root) {
    root.querySelectorAll('[data-here]').forEach((b) => (b.onclick = () => {
      const id = b.dataset.here, t = allTrips().find((x) => x.id === id); if (!t) return;
      tripsHere[id] = !tripsHere[id];
      b.classList.toggle('on', tripsHere[id]); b.setAttribute('aria-pressed', String(tripsHere[id]));
      b.textContent = (tripsHere[id] ? '✓ ' : '') + '📍 Ab meinem Standort';
      const box = root.querySelector(`[data-links="${CSS.escape(id)}"]`);
      if (box) box.outerHTML = btnSet(t, tripsHere[id]);
    }));
  }
  function tripsMiniCard(dKey) {
    const list = tripsOn(dKey); if (!list.length) return '';
    const nextId = tripPhase() === 'during' ? nextTripId() : null;
    return `<div class="card"><div class="row"><h2 class="grow" style="margin:0">🚗 Fahrten</h2><button class="btn ghost" data-trips="${dKey}">Alle ›</button></div>` + list.map((t) => {
      const f = tripPlace(t.from), to = tripPlace(t.to);
      const past = nextId && t.id !== nextId && t._ts + TRIP_GRACE <= Date.now();
      const short = (p) => cleanName(p).split(',')[0];
      return `<div class="trow ${t.id === nextId ? 'next' : ''} ${past ? 'past' : ''}"><div class="trow-t">${esc(t.timeLabel || t.time)}</div><div class="grow"><div style="font-weight:700">${esc(short(to))}${t.id === nextId ? ' <span class="badge">ALS NÄCHSTES</span>' : ''}</div><div class="tiny muted">${t.icon || MODES[t.mode].ico} ${esc(t.how || '')} · ab ${esc(short(f))}</div></div>${mapBtns(t, false, true)}</div>`;
    }).join('') + `</div>`;
  }
  function openTrips(date) { tripsFocus = date || null; prefs.tab = 'fahrten'; savePrefs(); renderTab(); if (!tripsFocus) window.scrollTo(0, 0); }

  /* ---------- Karte ---------- */
  function gcPoints(a, b, n) {
    const r = Math.PI / 180, toV = (p) => [Math.cos(p.lat * r) * Math.cos(p.lng * r), Math.cos(p.lat * r) * Math.sin(p.lng * r), Math.sin(p.lat * r)];
    const A = toV(a), B = toV(b), d = Math.acos(Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
    if (d < 1e-6) return [[a.lat, a.lng], [b.lat, b.lng]];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, s1 = Math.sin((1 - f) * d) / Math.sin(d), s2 = Math.sin(f * d) / Math.sin(d);
      const x = s1 * A[0] + s2 * B[0], y = s1 * A[1] + s2 * B[1], z = s1 * A[2] + s2 * B[2];
      out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / r, Math.atan2(y, x) / r]);
    }
    return out;
  }
  function viewKarte(m) {
    const P = TRIP.places;
    m.innerHTML = `<div class="seg" style="margin-bottom:10px"><button data-z="all" class="on">Gesamt</button><button data-z="fra">Frankfurt</button><button data-z="la">Los Angeles</button><button data-z="hnl">Honolulu</button></div>
      <div id="map"></div>
      <div class="card seg-list"><h3>Route</h3>${TRIP.route.map((s) => `<div class="sg"><div style="font-size:18px">${s.mode === 'flight' ? '✈️' : '🚗'}</div><div class="grow"><div style="font-weight:700">${esc(P[s.from].name.split(' (')[0])} → ${esc(P[s.to].name.split(' (')[0])}</div><div class="small muted">${esc(s.label)}</div></div></div>`).join('')}</div>
      <div class="tiny muted" style="text-align:center">Kartendaten © OpenStreetMap-Mitwirkende. Offline sind nur bereits angesehene Kartenausschnitte verfügbar.</div>`;
    if (!window.L) { $('#map').innerHTML = '<div class="empty">Karte konnte nicht geladen werden.</div>'; return; }
    map = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: false });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    TRIP.route.forEach((s) => {
      const a = P[s.from], b = P[s.to];
      if (s.mode === 'flight') L.polyline(gcPoints(a, b, 64), { color: '#F2557A', weight: 3, dashArray: '7 7', opacity: .9 }).addTo(map);
      else L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: '#6C3FD1', weight: 4, opacity: .85 }).addTo(map);
    });
    const main = ['mannheim', 'fra', 'lax', 'airbnb', 'hnl', 'hotel'];
    const LABEL = { mannheim: 'Mannheim', fra: 'Frankfurt FRA', lax: 'LAX', airbnb: 'Airbnb West Hollywood', hnl: 'HNL', hotel: 'Waikiki Circle Hotel' };
    const MAJOR = { fra: 'Frankfurt', airbnb: 'Los Angeles', hotel: 'Honolulu' };
    const entries = Object.entries(P).sort((a, b) => (main.includes(a[0]) ? 1 : 0) - (main.includes(b[0]) ? 1 : 0));
    const tips = [];
    entries.forEach(([id, p]) => {
      const isMain = main.includes(id);
      const color = p.idea ? '#FF9F43' : (id === 'airbnb' || id === 'hotel' ? '#0A8F95' : '#F2557A');
      const mk = L.circleMarker([p.lat, p.lng], { radius: isMain ? 8 : 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map);
      const q = encodeURIComponent(p.address || p.name);
      mk.bindPopup(`<b>${esc(p.name)}</b>${p.address ? '<br>' + esc(p.address) : ''}<br><a href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">In Apple Karten öffnen</a>`);
      if (isMain || p.idea) tips.push({ id, mk, p, isMain });
    });
    const relabel = () => {
      const z = map.getZoom();
      tips.forEach(({ id, mk, p, isMain }) => {
        mk.unbindTooltip();
        let txt = null;
        if (z <= 5) txt = MAJOR[id] || null;
        else if (isMain) txt = LABEL[id];
        else if (z >= 11) txt = p.name.split(' (')[0];
        if (txt) mk.bindTooltip(esc(txt), { permanent: true, direction: p.lng > 0 && z <= 5 ? 'left' : 'right', className: 'lbl', offset: [p.lng > 0 && z <= 5 ? -8 : 8, 0] });
      });
    };
    map.on('zoomend', relabel);
    const views = {
      all: L.latLngBounds([[P.hotel.lat, P.hotel.lng], [P.fra.lat, P.fra.lng], [P.lax.lat, P.lax.lng], [64, -40]]),
      fra: L.latLngBounds([[P.mannheim.lat, P.mannheim.lng], [P.fra.lat, P.fra.lng]]),
      la: L.latLngBounds([[P.lax.lat, P.lax.lng], [P.airbnb.lat, P.airbnb.lng], [P.griffith.lat, P.griffith.lng], [P.santamonica.lat, P.santamonica.lng], [P.getty.lat, P.getty.lng]]),
      hnl: L.latLngBounds([[P.hnl.lat, P.hnl.lng], [P.hotel.lat, P.hotel.lng], [P.hanauma.lat, P.hanauma.lng], [P.pearl.lat, P.pearl.lng]])
    };
    const fit = (z) => map.fitBounds(views[z], { padding: [28, 28] });
    const reg = (dayByDate(todayKey()) || {}).region;
    const startZ = tripPhase() === 'during' && views[reg] ? reg : 'all';
    setTimeout(() => { map.invalidateSize(); fit(startZ); relabel(); m.querySelectorAll('[data-z]').forEach((x) => x.classList.toggle('on', x.dataset.z === startZ)); }, 50);
    m.querySelectorAll('[data-z]').forEach((b) => (b.onclick = () => { m.querySelectorAll('[data-z]').forEach((x) => x.classList.toggle('on', x === b)); fit(b.dataset.z); }));
  }

  /* ---------- Checkliste ---------- */
  function isDone(id) { const c = STATE.checks[id]; return !!(c && c.d); }
  function allGroups() {
    const groups = TRIP.checklist.map((g) => ({ group: g.group, items: g.items.slice() }));
    const own = Object.entries(STATE.items).filter(([, v]) => !v.del).sort((a, b) => a[1].c - b[1].c);
    if (own.length) groups.push({ group: 'Eigene Punkte', own: true, items: own.map(([id, v]) => ({ id, text: v.text, own: true, by: v.by })) });
    return groups;
  }
  function openImportant() { return TRIP.checklist[0].items.filter((i) => !isDone(i.id)); }
  function viewListe(m) {
    const groups = allGroups();
    const all = groups.flatMap((g) => g.items), done = all.filter((i) => isDone(i.id)).length;
    let html = `<div class="card"><div class="row"><div class="grow"><div style="font-size:22px;font-weight:800">${done} / ${all.length}</div><div class="small muted">erledigt</div></div>
      <div class="seg" style="width:180px"><button data-f="0" class="${prefs.onlyOpen ? '' : 'on'}">Alle</button><button data-f="1" class="${prefs.onlyOpen ? 'on' : ''}">Offen</button></div></div>
      <div class="prog" style="margin-top:10px"><i style="width:${all.length ? (done / all.length) * 100 : 0}%"></i></div></div>`;
    groups.forEach((g) => {
      const items = prefs.onlyOpen ? g.items.filter((i) => !isDone(i.id)) : g.items;
      const gd = g.items.filter((i) => isDone(i.id)).length;
      if (!items.length) return;
      html += `<div class="sec-title">${esc(g.group)} · ${gd}/${g.items.length}</div><div class="card">` + items.map((it) => {
        const c = STATE.checks[it.id], d = isDone(it.id);
        return `<label class="ck ${d ? 'done' : ''}" data-id="${esc(it.id)}"><div class="box">${d ? '✓' : ''}</div><div class="grow"><div class="ck-t">${esc(it.text)}</div>
          ${it.note ? `<div class="ck-n">${esc(it.note)}</div>` : ''}${it.link ? `<div class="ck-n"><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.link.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></div>` : ''}
          ${d && c && c.by && c.by !== 'Daten' ? `<div class="ck-by">✓ ${esc(c.by)} · ${new Date(c.t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>` : ''}</div>
          ${it.own ? `<button class="del" data-del="${esc(it.id)}" aria-label="Löschen">×</button>` : ''}</label>`;
      }).join('') + `</div>`;
    });
    html += `<div class="card"><div class="row"><input id="newItem" class="inp grow" placeholder="Eigenen Punkt hinzufügen …"><button class="icon-btn" id="addItem">＋</button></div></div>`;
    m.innerHTML = html;
    m.querySelectorAll('.ck').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('a') || e.target.closest('.del')) return;
      e.preventDefault();
      const id = el.dataset.id, d = !isDone(id);
      STATE.checks[id] = { d, t: Date.now(), by: whoAmI() };
      saveState(true); viewListe(m);
    }));
    m.querySelectorAll('[data-del]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (!confirm('Punkt löschen?')) return; const it = STATE.items[b.dataset.del]; STATE.items[b.dataset.del] = Object.assign({}, it, { del: true, t: Date.now() }); saveState(true); viewListe(m); }));
    m.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { prefs.onlyOpen = b.dataset.f === '1'; savePrefs(); viewListe(m); }));
    const add = () => { const v = $('#newItem').value.trim(); if (!v) return; const id = 'own_' + uid(); STATE.items[id] = { text: v, c: Date.now(), t: Date.now(), by: whoAmI() }; saveState(true); viewListe(m); };
    $('#addItem').onclick = add; $('#newItem').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  }
  function whoAmI() { return prefs.me || 'Unbekannt'; }

  /* ---------- Budget ---------- */
  const fx = () => TRIP.budget.fxUsdPerEur;
  function catFactor(cat) {
    const B = TRIP.budget;
    if (prefs.budgetMode !== 'ziel' || cat !== B.target.reduceCategory) return 1;
    const c = B.categories.find((x) => x.id === cat), over = B.onsiteTotalEur - B.target.totalEur;
    if (!c || !c.plannedEur || over <= 0) return 1; // Ziel ≥ Plan: nichts kürzen (und nie hochskalieren)
    return Math.max(0, (c.plannedEur - over) / c.plannedEur);
  }
  function plannedFor(dayKey) { const p = TRIP.budget.dayPlan[dayKey] || {}; let s = 0; for (const k in p) s += p[k] * catFactor(k); return s; }
  function expenses() { return Object.entries(STATE.exp).filter(([, e]) => !e.del).map(([id, e]) => Object.assign({ id }, e)); }
  function spentFor(dayKey) { return expenses().filter((e) => e.day === dayKey).reduce((s, e) => s + e.eur, 0); }
  function dayBudget(dayKey) { return { planned: plannedFor(dayKey), spent: spentFor(dayKey) }; }
  function budgetDays() { return ['vorab'].concat(TRIP.days.map((d) => d.date)); }
  function rolloverBefore(dayKey) { let r = 0; for (const k of budgetDays()) { if (k === dayKey) break; r += plannedFor(k) - spentFor(k); } return r; }
  function totalPlanned() { return budgetDays().reduce((s, k) => s + plannedFor(k), 0); }
  function viewBudget(m) {
    const B = TRIP.budget, exps = expenses();
    const tp = totalPlanned(), ts = exps.reduce((s, e) => s + e.eur, 0);
    const paid = B.paid.reduce((s, p) => s + p.eur, 0);
    const t = todayKey();
    const remDays = TRIP.days.filter((d) => d.date >= t).length || 0;
    let html = `<div class="seg" style="margin-bottom:12px"><button data-mode="ziel" class="${prefs.budgetMode === 'ziel' ? 'on' : ''}">Ziel ${eur(B.target.totalEur)}</button><button data-mode="plan" class="${prefs.budgetMode === 'plan' ? 'on' : ''}">Plan ${eur(B.onsiteTotalEur)}</button></div>
      <div class="card"><h2>Vor Ort</h2><div class="kpis">
        <div class="kpi"><div class="v">${eur(tp)}</div><div class="l">Budget vor Ort</div></div>
        <div class="kpi teal"><div class="v">${eur(ts)}</div><div class="l">ausgegeben</div></div>
        <div class="kpi"><div class="v ${tp - ts < 0 ? 'neg' : ''}">${eur(tp - ts)}</div><div class="l">übrig</div></div>
        <div class="kpi teal"><div class="v">${remDays ? eur((tp - ts) / remDays) : '–'}</div><div class="l">pro verbleibendem Tag${remDays ? ` (${remDays})` : ''}</div></div></div>
        <div class="bar ${ts > tp ? 'over' : ''}" style="margin-top:12px"><i style="width:${Math.min(100, tp ? (ts / tp) * 100 : 0)}%"></i></div>
        <div class="tiny muted" style="margin-top:8px">Kurs: 1 € = ${String(B.fxUsdPerEur).replace('.', ',')} USD (${esc(B.fxSource)}). ${prefs.budgetMode === 'ziel' ? esc(B.target.note) : 'Plan laut Urlaubskasse.'}</div></div>`;
    // Tage
    html += `<div class="sec-title">Pro Tag</div><div class="card">` + budgetDays().map((k) => {
      const p = plannedFor(k), s = spentFor(k), over = s > p + 0.005;
      const lbl = k === 'vorab' ? 'Vor der Reise' : `${fmtDate(k)} · ${esc(dayByDate(k).title)}`;
      return `<div class="bday" data-day="${k}"><div class="row"><div class="grow small" style="font-weight:700${k === t ? ';color:var(--accent)' : ''}">${lbl}${k === t ? ' · heute' : ''}</div><div class="amt small"><span class="${over ? 'neg' : ''}">${eur(s)}</span> <span class="muted">/ ${eur(p)}</span></div></div>
        <div class="bar ${over ? 'over' : ''}" style="margin-top:6px;height:7px"><i style="width:${p ? Math.min(100, (s / p) * 100) : (s ? 100 : 0)}%"></i></div></div>`;
    }).join('') + `</div>`;
    // Kategorien
    html += `<div class="sec-title">Kategorien</div><div class="card">` + B.categories.map((c) => {
      const p = c.plannedEur * catFactor(c.id), s = exps.filter((e) => e.cat === c.id).reduce((a, e) => a + e.eur, 0);
      return `<div class="bday"><div class="row"><div style="font-size:20px">${c.icon}</div><div class="grow"><div style="font-weight:700">${esc(c.label)}</div><div class="tiny muted">${esc(c.note)}</div></div><div class="amt small"><span class="${s > p && p ? 'neg' : ''}">${eur(s)}</span> <span class="muted">/ ${eur(p)}</span></div></div>
        <div class="bar ${s > p ? 'over' : ''}" style="margin-top:6px;height:7px"><i style="width:${p ? Math.min(100, (s / p) * 100) : (s ? 100 : 0)}%"></i></div></div>`;
    }).join('') + `</div>`;
    // Ausgaben
    const list = exps.sort((a, b) => (b.day + b.c).localeCompare(a.day + a.c));
    html += `<div class="sec-title">Ausgaben (${list.length})</div><div class="card">` + (list.length ? list.map((e) => expRow(e)).join('') : '<div class="empty">Noch keine Ausgaben. Tippe auf „＋ Ausgabe“.</div>') + `</div>`;
    // Bereits bezahlt
    html += `<div class="sec-title">Schon bezahlt (vor der Reise)</div><div class="card">` + B.paid.map((p) => `<div class="bday"><div class="row"><div class="grow"><div style="font-weight:600">${esc(p.label)}</div><div class="tiny muted">${esc(p.note)}</div></div><div class="amt">${eur2(p.eur)}</div></div></div>`).join('') +
      (B.paidUnclear || []).map((p) => `<div class="bday"><div class="row"><div class="grow"><div style="font-weight:600" class="muted">${esc(p.label)}</div><div class="tiny muted">${esc(p.note)}</div></div><div class="amt muted">${eur2(p.eur)}</div></div></div>`).join('') +
      `<div class="bday"><div class="row"><div class="grow" style="font-weight:800">Summe bezahlt</div><div class="amt">${eur2(paid)}</div></div>
       <div class="row" style="margin-top:6px"><div class="grow small muted">Gesamtreise (bezahlt + Budget vor Ort)</div><div class="amt small">${eur(paid + tp)}</div></div></div></div>
      <div class="tiny muted" style="text-align:center">Quelle: ${esc(B.source)}</div>`;
    m.innerHTML = html;
    m.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { prefs.budgetMode = b.dataset.mode; savePrefs(); viewBudget(m); }));
    m.querySelectorAll('.exp').forEach((el) => (el.onclick = () => expenseSheet(STATE.exp[el.dataset.id] && Object.assign({ id: el.dataset.id }, STATE.exp[el.dataset.id]))));
    m.querySelectorAll('.bday[data-day]').forEach((el) => (el.onclick = () => expenseSheet(null, el.dataset.day)));
  }
  function expRow(e) {
    const c = TRIP.budget.categories.find((x) => x.id === e.cat) || { icon: '•', label: e.cat };
    const orig = e.cur === 'USD' ? `${e.amt.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $ · ` : '';
    return `<div class="exp" data-id="${esc(e.id)}"><div class="ci">${c.icon}</div><div class="grow"><div style="font-weight:600">${esc(e.note || c.label)}</div>
      <div class="tiny muted">${e.day === 'vorab' ? 'Vorab' : fmtDate(e.day)} · ${esc(c.label)} · ${esc(e.by || '')}</div></div><div class="amt"><div>${eur2(e.eur)}</div><div class="tiny muted" style="text-align:right">${orig}</div></div></div>`;
  }

  /* ---------- Sheets ---------- */
  function openSheet(html, onMount) {
    const root = $('#sheet-root');
    root.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
    const close = () => { root.innerHTML = ''; };
    $('.sheet-bg', root).onclick = close;
    onMount && onMount($('.sheet', root), close);
    return close;
  }
  function expenseSheet(existing, presetDay) {
    const B = TRIP.budget;
    const t = todayKey();
    const defDay = presetDay || (existing && existing.day) || (viewDay && prefs.tab === 'heute' ? viewDay : (dayByDate(t) ? t : (t < TRIP.meta.start ? 'vorab' : TRIP.meta.end)));
    let cur = existing ? existing.cur : 'USD', cat = existing ? existing.cat : 'essen', who = existing ? existing.by : (prefs.me || TRIP.meta.travelers[0]);
    const html = `<h2 style="margin:4px 0 12px">${existing ? 'Ausgabe bearbeiten' : 'Neue Ausgabe'}</h2>
      <div class="field"><input id="xAmt" class="inp big-amt" inputmode="decimal" placeholder="0,00" value="${existing ? String(existing.amt).replace('.', ',') : ''}"></div>
      <div class="field"><div class="seg" id="xCur"><button data-c="USD">US-Dollar $</button><button data-c="EUR">Euro €</button></div><div class="tiny muted" id="xConv" style="text-align:center;margin-top:6px"></div></div>
      <div class="field"><label>Kategorie</label><div class="chips" id="xCat">${B.categories.map((c) => `<button data-k="${c.id}">${c.icon} ${esc(c.label)}</button>`).join('')}</div></div>
      <div class="field"><label>Tag</label><select id="xDay" class="inp">${budgetDays().map((k) => `<option value="${k}" ${k === defDay ? 'selected' : ''}>${k === 'vorab' ? 'Vor der Reise' : fmtDate(k) + ' – ' + esc(dayByDate(k).title)}</option>`).join('')}</select></div>
      <div class="field"><label>Notiz</label><input id="xNote" class="inp" placeholder="z. B. Abendessen Waikīkī" value="${existing ? esc(existing.note || '') : ''}"></div>
      <div class="field"><label>Bezahlt von</label><div class="seg" id="xWho">${TRIP.meta.travelers.concat(['Gemeinsam']).map((n) => `<button data-w="${esc(n)}">${esc(n)}</button>`).join('')}</div></div>
      <button class="btn block" id="xSave">Speichern</button>${existing ? '<button class="btn sec block" id="xDel" style="margin-top:8px">Löschen</button>' : ''}`;
    openSheet(html, (sh, close) => {
      const upd = () => {
        sh.querySelectorAll('#xCur button').forEach((b) => b.classList.toggle('on', b.dataset.c === cur));
        sh.querySelectorAll('#xCat button').forEach((b) => b.classList.toggle('on', b.dataset.k === cat));
        sh.querySelectorAll('#xWho button').forEach((b) => b.classList.toggle('on', b.dataset.w === who));
        const a = parseAmt($('#xAmt').value);
        $('#xConv').textContent = a ? (cur === 'USD' ? `≈ ${eur2(a / fx())}` : `≈ ${(a * fx()).toLocaleString('de-DE', { maximumFractionDigits: 2 })} $`) : `Kurs 1 € = ${String(fx()).replace('.', ',')} $`;
      };
      sh.querySelectorAll('#xCur button').forEach((b) => (b.onclick = () => { cur = b.dataset.c; upd(); }));
      sh.querySelectorAll('#xCat button').forEach((b) => (b.onclick = () => { cat = b.dataset.k; upd(); }));
      sh.querySelectorAll('#xWho button').forEach((b) => (b.onclick = () => { who = b.dataset.w; upd(); }));
      $('#xAmt').oninput = upd; upd();
      if (!existing) setTimeout(() => $('#xAmt').focus(), 250);
      $('#xSave').onclick = () => {
        const a = parseAmt($('#xAmt').value);
        if (!a || a <= 0) { toast('Bitte einen Betrag eingeben'); return; }
        const id = existing ? existing.id : 'x_' + uid();
        STATE.exp[id] = { day: $('#xDay').value, amt: a, cur, eur: Math.round((cur === 'USD' ? a / fx() : a) * 100) / 100, cat, note: $('#xNote').value.trim(), by: who, c: existing ? existing.c : Date.now(), t: Date.now() };
        saveState(true); close(); renderTab(); toast('Gespeichert ✓');
      };
      $('#xDel') && ($('#xDel').onclick = () => { if (!confirm('Ausgabe löschen?')) return; STATE.exp[existing.id] = Object.assign({}, STATE.exp[existing.id], { del: true, t: Date.now() }); saveState(true); close(); renderTab(); });
    });
  }
  function parseAmt(s) { s = String(s || '').trim().replace(/\s/g, ''); if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); const n = parseFloat(s); return isFinite(n) ? Math.round(n * 100) / 100 : 0; }

  function a2hsSheet() {
    openSheet(`<h2 style="margin:4px 0 8px">📲 Auf den Home-Bildschirm (iPhone)</h2>
      <ol class="steps">
        <li>Den Link in <b>Safari</b> öffnen (nicht im WhatsApp-/Instagram-Browser – dort „In Safari öffnen“ wählen).</li>
        <li>Auf <b>Teilen</b> tippen (Quadrat mit Pfeil nach oben). Bei neuem iOS ggf. erst auf <b>•••</b> neben der Adresszeile, dann „Teilen“.</li>
        <li>Nach unten scrollen und <b>„Zum Home-Bildschirm“</b> wählen. Falls angezeigt: „Als Web-App öffnen“ eingeschaltet lassen.</li>
        <li>Name „USA-Reise“ lassen und <b>„Hinzufügen“</b> tippen.</li>
        <li>Die App über das neue Symbol öffnen. Falls nach dem Code gefragt wird: den Zugangscode einmal eingeben (die Home-Bildschirm-App hat einen eigenen Speicher).</li>
        <li>Einmal mit Internet öffnen – danach funktioniert sie auch offline (Karte nur für schon angesehene Bereiche).</li>
      </ol><button class="btn block" id="okA2">Alles klar</button>`, (sh, close) => { $('#okA2').onclick = close; });
  }

  /* ---------- Infos ---------- */
  function bookingCard(b, compact) {
    if (!b) return '';
    const q = b.address ? encodeURIComponent(b.address) : '';
    return `<div class="card"><div class="row"><div style="font-size:26px">${b.icon}</div><div class="grow"><h3 style="margin:0">${esc(b.title)}</h3><div class="small muted">${esc(b.subtitle || '')}</div></div></div>
      ${(b.codes || []).map(([k, c]) => `<div class="code"><div><div class="k">${esc(k)}</div><div class="c">${esc(c)}</div></div><button data-copy="${esc(c)}">Kopieren</button></div>`).join('')}
      ${b.address ? `<div class="small" style="margin-top:6px">📍 ${esc(b.address)}</div>` : ''}
      ${compact ? '' : `<ul class="lines">${(b.lines || []).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`}
      <div class="links">${b.address ? `<a href="https://maps.apple.com/?q=${q}" target="_blank" rel="noopener">🗺️ Karte</a>` : ''}${(b.phones || []).map(([l, p]) => `<a href="tel:${esc(p)}">📞 ${esc(l)}</a>`).join('')}${compact ? '' : (b.links || []).map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">↗ ${esc(l)}</a>`).join('')}</div></div>`;
  }
  function fmtPhone(p) { if (p.length <= 4) return p; if (p.startsWith('+1')) return `+1 ${p.slice(2, 5)} ${p.slice(5, 8)} ${p.slice(8)}`; if (p.startsWith('+49')) return `+49 ${p.slice(3, 5)} ${p.slice(5)}`; return p; }
  function viewInfos(m) {
    let html = driveEntry() + `<div class="sec-title">Buchungen</div>` + TRIP.bookings.map((b) => bookingCard(b)).join('');
    const groups = [...new Set(TRIP.contacts.map((c) => c.group))];
    html += `<div class="sec-title">Kontakte</div>` + groups.map((g) => `<div class="card"><h3>${esc(g)}</h3>${TRIP.contacts.filter((c) => c.group === g).map((c) => `<div class="contact"><div class="grow"><div style="font-weight:600">${esc(c.name)}</div>${c.note ? `<div class="tiny muted">${esc(c.note)}</div>` : ''}${c.phone ? `<div class="tiny muted">${esc(fmtPhone(c.phone))}</div>` : ''}</div>${c.phone ? `<a class="call" href="tel:${esc(c.phone)}">Anrufen</a>` : ''}${c.link ? `<a class="call" href="${esc(c.link)}" target="_blank" rel="noopener">Info</a>` : ''}</div>`).join('')}</div>`).join('');
    html += `<div class="sec-title">Einstellungen</div><div class="card">
      <div class="field"><label>Ich bin</label><div class="seg" id="meSeg">${TRIP.meta.travelers.map((n) => `<button data-me="${esc(n)}" class="${prefs.me === n ? 'on' : ''}">${esc(n)}</button>`).join('')}</div><div class="tiny muted" style="margin-top:6px">Wird bei Häkchen und Ausgaben vermerkt.</div></div>
      <div class="field"><label>Synchronisierung</label><div class="small">${Sync.cfg() ? `Aktiv – Häkchen und Ausgaben werden verschlüsselt zwischen euren Handys abgeglichen.${Sync.last ? ' Zuletzt: ' + new Date(Sync.last).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}${Sync.status === 'err' ? `<div class="note-warn">Letzter Versuch fehlgeschlagen (${esc(Sync.error)}). Wird automatisch wiederholt.</div>` : ''}` : 'Nicht eingerichtet – Daten bleiben auf diesem Handy. Über „Stand teilen“ kann man den Stand manuell austauschen.'}</div>
        ${Sync.cfg() ? '<button class="btn sec block" id="syncNow" style="margin-top:8px">Jetzt synchronisieren</button>' : ''}</div>
      <div class="field"><label>Stand manuell austauschen</label><div class="row"><button class="btn sec grow" id="exp">Stand teilen</button><button class="btn sec grow" id="imp">Stand einfügen</button></div></div>
      <button class="btn sec block" id="howA2">📲 Anleitung: Auf den Home-Bildschirm</button>
      <div class="tiny muted" style="margin-top:12px">Datenstand ${esc(TRIP.meta.dataVersion)} (aktualisiert ${esc(TRIP.meta.updated)}). Gerätezeitzone: ${esc(deviceTz())}.</div>
      <button class="btn ghost" id="logout" style="margin-top:4px">Code auf diesem Gerät vergessen</button></div>`;
    m.innerHTML = html;
    bindCopy(m); bindDrive(m);
    m.querySelectorAll('[data-me]').forEach((b) => (b.onclick = () => { prefs.me = b.dataset.me; savePrefs(); viewInfos(m); toast('Hallo ' + prefs.me + ' 👋'); }));
    $('#syncNow') && ($('#syncNow').onclick = () => { Sync.run().then(() => viewInfos(m)); });
    $('#howA2').onclick = a2hsSheet;
    $('#logout').onclick = () => { if (confirm('Zugangscode auf diesem Gerät löschen? Häkchen/Ausgaben bleiben gespeichert.')) { localStorage.removeItem(LS.code); location.hash = ''; location.reload(); } };
    $('#exp').onclick = async () => {
      const box = await encryptJSON(KEY, STATE); const txt = 'USA26:' + btoa(JSON.stringify(box));
      try { if (navigator.share) await navigator.share({ title: 'USA-Reise Stand', text: txt }); else { await navigator.clipboard.writeText(txt); toast('In die Zwischenablage kopiert'); } } catch (e) { try { await navigator.clipboard.writeText(txt); toast('In die Zwischenablage kopiert'); } catch (e2) { prompt('Kopieren:', txt); } }
    };
    $('#imp').onclick = () => {
      openSheet(`<h2 style="margin:4px 0 8px">Stand einfügen</h2><p class="small muted">Den geteilten Text (beginnt mit „USA26:“) hier einfügen. Er wird mit deinem Stand zusammengeführt – nichts geht verloren.</p><textarea id="impT" class="inp" rows="5"></textarea><button class="btn block" id="impGo" style="margin-top:10px">Zusammenführen</button>`, (sh, close) => {
        $('#impGo').onclick = async () => {
          try { const box = JSON.parse(atob($('#impT').value.trim().replace(/^USA26:/, ''))); const other = await decryptJSON(KEY, box); STATE = mergeState(STATE, other); saveState(true); close(); renderTab(); toast('Zusammengeführt ✓'); }
          catch (e) { toast('Text ungültig'); }
        };
      });
    };
  }
  function bindCopy(root) {
    root.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Kopiert: ' + b.dataset.copy); } catch (e) { toast(b.dataset.copy); } }));
  }

  /* ---------- Misc ---------- */
  function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isStandalone() { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }
  let toastT = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

  // Test-Hook: ?now=2026-10-13T09:00:00Z simuliert die Uhrzeit (nur für Vorschau/Screenshots)
  const qNow = new URLSearchParams(location.search).get('now');
  if (qNow && !isNaN(Date.parse(qNow))) { const off = Date.parse(qNow) - Date.now(); const RD = Date; Date.now = () => RD.prototype.getTime.call(new RD()) + off; }
  document.addEventListener('DOMContentLoaded', boot);
})();
