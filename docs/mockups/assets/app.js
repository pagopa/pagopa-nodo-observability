/* Shell condivisa e helper dei mockup. Dati di esempio fittizi. */
(function () {
  const ICONS = {
    search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>',
    warn: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  };
  const icon = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const hydrateIcons = (root = document) => $$('i[data-i]', root).forEach(e => { e.outerHTML = icon(e.dataset.i, e.dataset.c || ''); });
  const fmtN = n => new Intl.NumberFormat('it-IT', { useGrouping: 'always' }).format(Math.round(n));

  /* ---------- stati ---------- */
  const SC = {
    PAYING: 'info', PAYING_RPT: 'info', PAYMENT_RESERVED: 'info', PAYMENT_SENT: 'info',
    PAYMENT_ACCEPTED: 'info', PAID: 'ok', PAID_NORPT: 'ok', NOTIFIED: 'info', NOTICE_GENERATED: 'info', NOTICE_STORED: 'info', NOTICE_SENT: 'info', NOTICE_PENDING: 'info',
    PAYMENT_UNKNOWN: 'warn', PAYMENT_SEND_ERROR: 'warn',
    PAYMENT_REFUSED: 'mute', CANCELLED: 'mute', CANCELLED_NORPT: 'mute', FAILED: 'mute', FAILED_NORPT: 'mute', INSERTED: 'mute'
  };
  const UNRESOLVED = new Set(['PAYMENT_UNKNOWN', 'PAYMENT_SEND_ERROR']);
  const escape = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const STATE_GROUPS = {
    logical: [
      ['Disponibilità e attivazione', ['INSERTED', 'PAYING']],
      ['Pagamento acquisito', ['PAID']],
      ['Archiviazione o notifica', ['NOTICE_STORED', 'NOTIFIED']]
    ],
    attempt: [
      ['Attivazione', ['PAYING', 'PAYING_RPT']],
      ['Prenotazione e notifica PSP', ['PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_ACCEPTED', 'PAYMENT_UNKNOWN', 'PAYMENT_REFUSED', 'PAYMENT_SEND_ERROR']],
      ['Esito del pagamento', ['PAID', 'FAILED', 'CANCELLED']],
      ['Ricevuta', ['NOTICE_GENERATED', 'NOTICE_STORED', 'NOTICE_SENT', 'NOTIFIED']],
      ['Varianti senza RPT', ['PAID_NORPT', 'FAILED_NORPT', 'CANCELLED_NORPT']]
    ],
    recipient: [
      ['Consegna al destinatario', ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTICE_PENDING', 'NOTIFIED']]
    ]
  };
  const MEANINGS = {
    INSERTED: 'Avviso disponibile o posizione riaperta: può ricevere un nuovo tentativo.',
    PAYING: 'In pagamento. Non certifica ancora il saldo della posizione.',
    PAYING_RPT: 'Tentativo in corso nel percorso con RPT; distinto da PAYING.',
    PAYMENT_RESERVED: 'Prenotazione dopo closePayment OK; notifica PSP non ancora inviata.',
    PAYMENT_SENT: 'Notifica inviata al PSP: in attesa della risposta.',
    PAYMENT_ACCEPTED: 'Accettato dal PSP, in attesa dell’esito del pagamento. Non equivale a PAID.',
    PAYMENT_UNKNOWN: 'Esito della notifica non risolto: non è un KO definitivo. Può arrivare un outcome positivo oppure un annullo ammesso dal Nodo.',
    PAYMENT_SEND_ERROR: 'Errore di trasporto nella notifica PSP. Il warning resta finché il tentativo non evolve.',
    PAYMENT_REFUSED: 'Notifica rifiutata dal PSP; distinta dall’esito KO di sendPaymentOutcome.',
    PAID: 'Pagamento acquisito con esito positivo. La consegna della ricevuta è una fase distinta.',
    FAILED: 'Tentativo fallito con outcome KO ammesso; non è sinonimo di CANCELLED.',
    CANCELLED: 'Tentativo annullato. La posizione può riaprirsi e ricevere un nuovo token.',
    PAID_NORPT: 'Pagamento positivo senza RPT; completamento legacy successivo.',
    FAILED_NORPT: 'Esito negativo senza RPT; completamento legacy successivo.',
    CANCELLED_NORPT: 'Variante legacy senza RPT; ingresso nel ramo da verificare.',
    NOTICE_GENERATED: 'Ricevuta generata: non dimostra che sia già stata inviata.',
    NOTICE_STORED: 'Ricevuta archiviata: non prova la consegna alla PA.',
    NOTICE_SENT: 'Invio della ricevuta avviato: non dimostra il completamento delle risposte.',
    NOTICE_PENDING: 'Consegna a questo destinatario in attesa di retry dopo timeout o errore.',
    NOTIFIED: 'Risposta valida ricevuta: non prova un esito applicativo PA positivo.'
  };
  function stateMeaning(state, entity = 'attempt') {
    if (state === 'NOTIFIED') {
      if (entity === 'logical') return 'Risposta valida della PA intestataria, alle condizioni previste. Non prova un esito applicativo PA positivo.';
      if (entity === 'attempt') return 'Risposte valide di tutti i destinatari richiesti. Non prova un esito applicativo PA positivo.';
      return 'Risposta valida di questo destinatario, anche con outcome applicativo KO.';
    }
    if (state === 'NOTICE_STORED' && entity === 'logical') return 'Ricevuta archiviata. La posizione resta NOTICE_STORED anche dopo la consegna.';
    return MEANINGS[state] || 'Stato non riconosciuto: valore originale conservato, nessun esito dedotto.';
  }
  const badge = (s, extra = '', entity = 'attempt') => `<span class="badge b-${SC[s] || 'mute'}" title="${escape(stateMeaning(s, entity))}">${UNRESOLVED.has(s) ? icon('warn') : ''}${escape(s)}${extra}</span>`;
  const stateOptions = entity => STATE_GROUPS[entity].map(([phase, states]) =>
    `<optgroup label="${phase}">${states.map(state => `<option value="${state}">${state}</option>`).join('')}</optgroup>`).join('');
  function stateGuide() {
    return `<details class="state-guide" id="state-guide"><summary>Come leggere gli stati: PSP, pagamento e ricevuta</summary>
      <div class="semantic-grid">
        <p><strong>PAYMENT_ACCEPTED ≠ PAID</strong><br>Accettazione della notifica PSP: il tentativo è in attesa dell’esito del pagamento. La posizione resta PAYING.</p>
        <p><strong>PAID ≠ consegna completata</strong><br>Il pagamento è acquisito; generazione, archiviazione e consegna della ricevuta sono fasi distinte.</p>
        <p><strong>NOTICE_STORED ≠ NOTIFIED</strong><br>Archiviazione non è consegna. La posizione archiviata resta NOTICE_STORED anche se il tentativo prosegue.</p>
        <p><strong>NOTIFIED: dipende dall’entità</strong><br>Posizione: risposta PA intestataria alle condizioni previste. Tentativo: tutti i destinatari richiesti. Non prova un esito applicativo PA positivo.</p>
        <p><strong>FAILED ≠ CANCELLED</strong><br>Outcome KO ammesso e annullamento sono distinti. Un nuovo token è un nuovo tentativo, non la riapertura del precedente.</p>
        <p><strong>Storia e schema non sono la stessa cosa</strong><br>Le fasi aiutano a leggere i percorsi, non sono passaggi obbligatori. I colori non certificano un esito finanziario.</p>
      </div></details>`;
  }

  /* ---------- fuso orario ---------- */
  const tz = () => store.get('tz', 'Europe/Rome');
  function fmt(iso, f) {
    const d = new Date(iso);
    const o = { timeZone: tz(), hour: '2-digit', minute: '2-digit', hour12: false };
    if (f !== 'hm') o.second = '2-digit';
    if (f === 'full' || f === 'ms' || f === 'dm') { o.day = '2-digit'; o.month = '2-digit'; if (f !== 'dm') o.year = 'numeric'; }
    let s = new Intl.DateTimeFormat('it-IT', o).format(d).replace(', ', ' ');
    if (f === 'ms') s += '.' + String(d.getUTCMilliseconds()).padStart(3, '0');
    return s;
  }
  const T = (iso, f = 'time') => `<time data-utc="${iso}" data-f="${f}">${fmt(iso, f)}</time>`;
  const hydrateTimes = (root = document) => $$('time[data-utc]', root).forEach(t => { t.textContent = fmt(t.dataset.utc, t.dataset.f); t.title = t.dataset.utc + ' (UTC)'; });

  /* ---------- shell ---------- */
  const NAV = [
    ['index.html', 'Dashboard', 'dash'],
    ['02-pagamenti.html', 'Pagamenti', 'pay'],
    ['04-enti-creditori.html', 'Enti creditori', 'ent']
  ];
  function shell() {
    const page = document.body.dataset.page;
    document.body.dataset.role = 'auth';
    const top = `
<header class="topbar"><div class="wrap">
  <span class="org">PagoPA S.p.A.</span>
  <div class="topbar-r">
    <label>Fuso orario
      <select id="tz" aria-label="Fuso orario">
        <option value="Europe/Rome">Europe/Rome</option><option value="UTC">UTC</option>
      </select>
    </label>
    <span class="user">${icon('user')}<span>Operatore demo</span></span>
  </div>
</div></header>
<div class="wrap brandbar">
  <a class="logo" href="index.html" aria-label="Dashboard"><b>Osservabili</b><span>PA</span></a>
  <span class="product">Osservabilità<br>pagamenti</span>
  <nav class="nav">${NAV.map(n => `<a href="${n[0]}" class="${n[2] === page ? 'active' : ''}">${n[1]}</a>`).join('')}</nav>
  <span class="live" id="live">Anteprima statica · dati fittizi</span>
</div>`;
    const bottom = `
<footer class="footer"><div class="wrap">
  <nav><a href="#">Accessibilità</a><a href="#">Aiuto</a><a href="#">Privacy</a><a href="#">Condizioni</a><a href="#">Stato della piattaforma</a><a href="#">Italiano ▾</a></nav>
  <span class="fl">pagoPA</span>
</div></footer>
<details class="demo" id="demo"><summary>Controlli demo</summary><div class="in">
  <div id="demo-extra" class="demo-extra"></div>
  <span class="muted xs">Dati fittizi. Nessun IAM: token in chiaro per tutti. Il mockup non è collegato a sistemi reali; gli aggiornamenti sono simulati.</span>
</div></details>`;
    document.body.insertAdjacentHTML('afterbegin', top);
    document.body.insertAdjacentHTML('beforeend', bottom);
    const sel = $('#tz'); sel.value = tz();
    sel.addEventListener('change', () => { store.set('tz', sel.value); hydrateTimes(); document.dispatchEvent(new Event('tzchange')); });
    hydrateIcons();
  }
  function toast(msg, ms = 3800) {
    $$('.toast').forEach(t => t.remove());
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = msg; document.body.appendChild(t);
    hydrateIcons(t); setTimeout(() => t.remove(), ms);
  }

  /* ---------- grafici ---------- */
  const niceMax = m => { const p = 10 ** Math.floor(Math.log10(m || 1)); return Math.ceil(m / p) * p; };
  function stackedBars(el, { series, labels, labelEvery = 3, h = 210, titleFmt }) {
    const W = 900, pad = { l: 48, r: 8, t: 10, b: 26 };
    const n = labels.length, sums = labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
    const max = niceMax(Math.max(...sums)), iw = W - pad.l - pad.r, ih = h - pad.t - pad.b, bw = iw / n;
    const y = v => pad.t + ih - (v / max) * ih;
    let g = '';
    [0, .5, 1].forEach(f => { const v = max * f; g += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmtN(v)}</text>`; });
    let bars = '';
    labels.forEach((lb, i) => {
      let acc = 0;
      series.forEach(s => {
        const v = s.values[i]; if (!v) return;
        const top = y(acc + v), hh = y(acc) - top;
        bars += `<rect class="b" x="${pad.l + i * bw + bw * .14}" y="${top}" width="${bw * .72}" height="${Math.max(hh, 1)}" fill="${s.fill}"><title>${lb} · ${s.name}: ${fmtN(v)}</title></rect>`;
        acc += v;
      });
      if (i % labelEvery === 0) bars += `<text x="${pad.l + i * bw + bw / 2}" y="${h - 8}" text-anchor="middle">${lb}</text>`;
    });
    el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Grafico a barre"><defs>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#EAF3FD"/><line x1="0" y1="0" x2="0" y2="6" stroke="#0073E6" stroke-width="2.2"/></pattern></defs>${g}${bars}</svg>`;
  }
  function spark(values, color = '#0073E6', w = 110, h = 28) {
    const mx = Math.max(...values), mn = Math.min(...values), r = mx - mn || 1;
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - ((v - mn) / r) * (h - 6)}`).join(' ');
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" points="${pts}"/></svg>`;
  }
  const stack = (parts) => `<div class="stack">${parts.map(p => `<i class="stack-segment" data-value="${p[0]}" data-color="${p[1]}" title="${p[2] || ''}"></i>`).join('')}</div>`;
  const hydrateBars = (root = document) => $$('[data-bar-width]', root).forEach(bar => {
    bar.style.setProperty('--bar-width', `${bar.dataset.barWidth}%`);
    if (bar.dataset.barColor) bar.style.setProperty('--bar-color', bar.dataset.barColor);
  });
  const hydrateStack = (root = document) => $$('.stack', root).forEach(el => {
    const parts = $$('.stack-segment', el);
    const total = parts.reduce((sum, part) => sum + Number(part.dataset.value), 0) || 1;
    parts.forEach(part => {
      part.style.setProperty('--segment-width', `${Number(part.dataset.value) / total * 100}%`);
      part.style.setProperty('--segment-color', part.dataset.color);
    });
  });
  const rnd = (seed) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

  window.UI = { $, $$, store, icon, hydrateIcons, fmtN, SC, UNRESOLVED, badge, escape, STATE_GROUPS, stateMeaning, stateOptions, stateGuide, tz, fmt, T, hydrateTimes, toast, stackedBars, spark, stack, hydrateBars, hydrateStack, rnd, shell };
  document.addEventListener('DOMContentLoaded', () => { shell(); hydrateTimes(); document.dispatchEvent(new Event('shellready')); });
})();
