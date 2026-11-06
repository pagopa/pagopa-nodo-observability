/* Synthetic acceptance scenarios. No requests or client-side state inference. */
(() => {
  const { $, badge, icon, T, UNRESOLVED, stateMeaning, STATE_GROUPS } = UI;
  const query = new URLSearchParams(location.search);
  const instant = seconds => new Date(Date.UTC(2026, 9, 23, 8, 0, seconds)).toISOString();
  const triggers = {
    INSERTED: 'sendPaymentResult', PAYING: 'activatePaymentNoticeV2',
    PAYMENT_RESERVED: 'closePaymentV2', PAYMENT_SENT: 'pspNotifyPaymentV2',
    PAYMENT_ACCEPTED: 'pspNotifyPaymentV2', PAYMENT_UNKNOWN: 'pspNotifyPaymentV2',
    PAYMENT_REFUSED: 'pspNotifyPaymentV2', PAYMENT_SEND_ERROR: 'pspNotifyPaymentV2',
    CANCELLED: 'sendPaymentResult', PAID: 'sendPaymentOutcomeV2', FAILED: 'sendPaymentOutcomeV2',
    PAID_NORPT: 'sendPaymentOutcome', NOTICE_GENERATED: 'sendPaymentOutcomeV2',
    NOTICE_STORED: 'sendPaymentOutcome', NOTICE_SENT: 'paSendRTV2', NOTIFIED: 'paSendRTV2',
    NOTICE_PENDING: 'paSendRTV2'
  };
  const history = (states, start = 0) => states.map((state, index) => ({
    state, at: instant(start + index * 30), basis: 'SOURCE_EVENT', trigger: triggers[state] || null
  }));
  const token = (id, states, start = 0) => ({
    id, token: `SYNTHETIC-TOKEN-${id}`, started: instant(start),
    service: 'NODO_V2', psp: 'ABI00001', station: '00000000001_01',
    channel: 'SYNTHETIC_CHANNEL', history: history(states, start)
  });
  const recipient = (id, states) => ({ id, station: `00000000001_${id}`, history: history(states, 150) });
  const cases = {
    unresolved: {
      label: 'Non risolto, annullo precedente e riapertura',
      position: history(['PAYING', 'INSERTED', 'PAYING']),
      attempts: [
        token('B', ['PAYING', 'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_UNKNOWN'], 60),
        token('A', ['PAYING', 'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_REFUSED', 'CANCELLED'])
      ],
      note: 'La posizione è nuovamente in pagamento. Il token annullato conserva la propria storia; il warning riguarda solo il token non risolto.'
    },
    paid: {
      label: 'Pagato dopo un tentativo annullato',
      position: history(['PAYING', 'INSERTED', 'PAYING', 'PAID']),
      attempts: [
        token('B', ['PAYING', 'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_ACCEPTED', 'PAID'], 60),
        token('A', ['PAYING', 'CANCELLED'])
      ],
      note: 'Il pagamento è acquisito. La ricevuta può ancora essere generata e consegnata: PAID non significa consegna completata.'
    },
    accepted: {
      label: 'PSP accetta: pagamento ancora in attesa',
      position: history(['PAYING']),
      attempts: [token('A', ['PAYING', 'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_ACCEPTED'])],
      note: 'Accettato dal PSP, in attesa dell’esito del pagamento. La posizione resta PAYING: manca il successivo outcome positivo.'
    },
    direct: {
      label: 'Outcome diretto senza ramo PSP',
      position: history(['PAYING', 'PAID']),
      attempts: [token('A', ['PAYING', 'PAID'])],
      note: 'Percorso con outcome diretto: senza prenotazione e notifica PSP. Nessun PAYMENT_ACCEPTED viene inventato prima di PAID.'
    },
    failed: {
      label: 'Outcome KO ammesso: posizione riaperta',
      position: [
        { state: 'PAYING', at: instant(0), basis: 'SOURCE_EVENT', trigger: 'activatePaymentNoticeV2' },
        { state: 'INSERTED', at: instant(30), basis: 'SOURCE_EVENT', trigger: 'sendPaymentOutcomeV2' }
      ],
      attempts: [token('A', ['PAYING', 'FAILED'])],
      note: 'Outcome KO accettato dal Nodo nel percorso NM3: tentativo FAILED, posizione INSERTED e disponibile per un nuovo tentativo. Non estendere il KO a ogni flusso eCommerce.'
    },
    partial: {
      label: 'Posizione notificata, consegna parziale del tentativo',
      position: history(['PAYING', 'PAID', 'NOTIFIED']),
      attempts: [token('A', ['PAYING', 'PAID', 'NOTICE_GENERATED', 'NOTICE_SENT'])],
      recipients: [
        recipient('01', ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTIFIED']),
        recipient('02', ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTICE_PENDING'])
      ],
      note: 'La posizione è NOTIFIED sulla risposta valida della PA intestataria, alle condizioni previste. Il tentativo resta NOTICE_SENT: il suo completamento richiede le risposte di tutti i destinatari richiesti. Non è un’anomalia.'
    },
    archived: {
      label: 'Posizione archiviata, tentativo notificato e retry',
      position: history(['PAYING', 'PAID', 'NOTICE_STORED']),
      attempts: [token('A', ['PAYING', 'PAID', 'NOTICE_GENERATED', 'NOTICE_STORED', 'NOTICE_SENT', 'NOTIFIED'])],
      recipients: [recipient('01', ['NOTICE_GENERATED', 'NOTICE_SENT', 'NOTICE_PENDING', 'NOTICE_SENT', 'NOTIFIED'])],
      note: 'Percorso illustrato nel PDF: il tentativo prosegue nella consegna, mentre la posizione resta NOTICE_STORED. L’invio dopo archiviazione richiede conferma Nodo per ramo/versione: questa anteprima non certifica il percorso in produzione.'
    },
    legacy: {
      label: 'Legacy: outcome senza RPT e RPT tardiva',
      position: history(['PAYING', 'PAID', 'NOTICE_STORED']),
      attempts: [token('A', ['PAYING', 'PAID_NORPT', 'PAID', 'NOTICE_GENERATED', 'NOTICE_STORED'])],
      note: 'La RPT tardiva completa PAID_NORPT e permette l’archiviazione legacy. Ricevuta archiviata non significa ricevuta consegnata.'
    },
    incomplete: {
      label: 'Storia incompleta e data-ora anomala',
      position: history(['PAYING']),
      attempts: [token('A', ['PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_UNKNOWN'])],
      note: 'Storia incompleta: il primo evento disponibile non prova tutti i passaggi precedenti. Nessun PAYING viene aggiunto come osservato e nessuna data viene sostituita con l’ora del browser.'
    }
  };
  cases.unresolved.position[1].at = instant(120);
  cases.unresolved.position[2].at = instant(180);
  cases.unresolved.attempts[0] = token('B', ['PAYING', 'PAYMENT_RESERVED', 'PAYMENT_SENT', 'PAYMENT_UNKNOWN'], 180);
  cases.unresolved.attempts[0].history[1].basis = 'INFERRED';
  cases.unresolved.attempts[1].history.at(-1).at = null;
  cases.unresolved.attempts[1].history.at(-1).basis = 'ANOMALY';
  cases.paid.position[1].trigger = 'closePaymentV2';
  cases.paid.position.at(-1).at = instant(180);
  cases.paid.attempts[1].history.at(-1).trigger = 'closePaymentV2';
  cases.partial.position.at(-1).at = instant(210);
  cases.archived.position.at(-1).at = instant(90);
  cases.archived.attempts[0].history.at(-2).at = instant(180);
  cases.archived.attempts[0].history.at(-1).at = instant(270);
  cases.legacy.attempts[0].history.slice(2).forEach(entry => { entry.trigger = 'NodoInviaRPT'; });
  cases.legacy.position.at(-1).at = instant(120);
  cases.legacy.position.at(-1).trigger = 'NodoInviaRPT';
  cases.incomplete.attempts[0].started = null;
  cases.incomplete.attempts[0].incomplete = true;
  cases.incomplete.attempts[0].history[0].basis = 'INFERRED';
  cases.incomplete.attempts[0].history.at(-1).basis = 'ANOMALY';
  cases.incomplete.attempts[0].history.at(-1).at = null;
  let caseKey = query.get('case') || 'unresolved';
  let scenario = Object.hasOwn(cases, caseKey) ? structuredClone(cases[caseKey]) : null;

  const arcs = {
    logical: [
      ['Inizio', 'INSERTED', 'Inserimento con RPT'],
      ['Inizio', 'PAYING', 'Attivazione: INSERTED non è obbligatorio'],
      ['INSERTED', 'PAYING', 'Nuova attivazione e nuovo tentativo'],
      ['PAYING', 'INSERTED', 'KO o annullo ammesso dal Nodo'],
      ['PAYING', 'PAID', 'Outcome positivo; nei flussi legacy anche RT OK'],
      ['PAID', 'NOTICE_STORED', 'Archiviazione, anche con RPT tardiva'],
      ['PAID', 'NOTIFIED', 'Risposta valida PA intestataria, alle condizioni previste']
    ],
    attempt: [
      ['PAYING', 'PAYMENT_RESERVED', 'closePayment OK nel percorso previsto'],
      ['PAYMENT_RESERVED', 'PAYMENT_SENT', 'Notifica PSP inviata'],
      ['PAYMENT_SENT', 'PAYMENT_ACCEPTED', 'Risposta PSP OK; non è PAID'],
      ['PAYMENT_SENT', 'PAYMENT_UNKNOWN', 'Timeout o risposta non determinabile'],
      ['PAYMENT_SENT', 'PAYMENT_REFUSED', 'Risposta PSP KO esplicita'],
      ['PAYMENT_SENT', 'PAYMENT_SEND_ERROR', 'Errore di trasporto'],
      ['PAYMENT_ACCEPTED', 'PAID', 'Successivo outcome positivo'],
      ['PAYMENT_UNKNOWN', 'PAID', 'Successivo outcome positivo'],
      ['PAYMENT_UNKNOWN', 'CANCELLED', 'Annullo Nodo alle condizioni di scadenza/gruppo'],
      ['PAYMENT_REFUSED', 'CANCELLED', 'sendPaymentResult KO'],
      ['PAYMENT_SEND_ERROR', 'CANCELLED', 'sendPaymentResult KO'],
      ['PAYING', 'PAID', 'Outcome diretto positivo, se ammesso dal percorso'],
      ['PAYING', 'FAILED', 'Outcome diretto KO, solo nei percorsi che lo accettano'],
      ['PAYING', 'CANCELLED', 'Close KO o annullo ammesso'],
      ['PAID', 'NOTICE_GENERATED', 'Generazione ricevuta'],
      ['NOTICE_GENERATED', 'NOTICE_STORED', 'Archiviazione nel ramo con RPT'],
      ['NOTICE_GENERATED', 'NOTICE_SENT', 'Invio alla PA intestataria'],
      ['NOTICE_STORED', 'NOTICE_SENT', 'PDF: applicabilità da confermare per ramo/versione'],
      ['NOTICE_SENT', 'NOTIFIED', 'Risposte valide di tutti i destinatari richiesti'],
      ['PAID_NORPT', 'PAID', 'Completamento legacy con RPT'],
      ['FAILED_NORPT', 'FAILED', 'Completamento legacy'],
      ['CANCELLED_NORPT', 'CANCELLED', 'Completamento legacy']
    ],
    recipient: [
      ['NOTICE_GENERATED', 'NOTICE_SENT', 'Invio a questo destinatario'],
      ['NOTICE_SENT', 'NOTICE_PENDING', 'Timeout o errore; attesa retry'],
      ['NOTICE_PENDING', 'NOTICE_SENT', 'Retry'],
      ['NOTICE_SENT', 'NOTIFIED', 'HTTP 200 e payload valido, anche outcome KO']
    ]
  };
  const current = entries => entries.at(-1).state;
  const basis = entry => entry.basis === 'INFERRED' ? 'Inferito · data-ora stimata'
    : entry.basis === 'ANOMALY' ? 'Anomalia · data-ora non disponibile' : 'Evento di esempio';
  const time = entry => entry.at ? T(entry.at, 'ms') : '<span class="anomaly-copy">Data-ora non disponibile</span>';

  function observedHistory(entity, entries) {
    return `<h4 class="history-heading">Storia osservata · ${entries.length} transizioni</h4>
      <ol class="observed-history">${entries.map((entry, index) => {
        const isCurrent = index === entries.length - 1;
        return `<li class="observed-step ${isCurrent ? 'current' : ''} ${entry.basis === 'INFERRED' ? 'inferred' : ''}"
          data-state="${entry.state}" ${isCurrent ? 'aria-current="step"' : ''}>
          <div class="chips"><span class="history-number">${index + 1}</span>${badge(entry.state, '', entity)}${isCurrent ? '<span class="tag">Corrente</span>' : ''}</div>
          <p class="state-description">${stateMeaning(entry.state, entity)}</p>
          <div class="small">${time(entry)}</div><div class="xs muted">${basis(entry)}</div>
          <code class="small">${entry.trigger || 'Trigger non disponibile'}</code>
        </li>`;
      }).join('')}</ol>`;
  }

  function schema(entity, entries) {
    const visited = new Set(entries.map(entry => entry.state));
    return `<details class="path-schema" data-entity="${entity}">
      <summary>Percorsi possibili · schema documentale, non una previsione</summary>
      <p class="small muted">Le fasi raggruppano stati alternativi, non sono passaggi obbligatori. Solo la storia sopra indica cosa è stato osservato.</p>
      <div class="phase-grid">${STATE_GROUPS[entity].map(([label, states]) => `<div class="phase">
        <h4>${label}</h4>${states.map(state => `<div class="phase-state">${badge(state, '', entity)}
          <span class="xs muted">${visited.has(state) ? 'Presente nella storia' : 'Possibile · non osservato'}</span></div>`).join('')}
        </div>`).join('')}</div>
      <h4>Relazioni documentate</h4><ul class="arc-list">${arcs[entity].map(([from, to, condition]) =>
        `<li data-from="${from}" data-to="${to}"><code>${from} → ${to}</code><span>${condition}</span></li>`).join('')}</ul>
      ${entity === 'logical' ? '<p class="small"><strong>Nessuna uscita da NOTICE_STORED verso NOTIFIED.</strong> Il tentativo può invece proseguire nella consegna.</p>' : ''}
      ${entity === 'attempt' ? '<p class="small"><strong>Legacy e limiti:</strong> PAYING_RPT è distinto da PAYING. Gli ingressi in PAYING_RPT e CANCELLED_NORPT restano da verificare; alcuni flussi PA OLD possono iniziare da PAYMENT_RESERVED. Lo schema non impone stati precedenti mancanti.</p>' : ''}
    </details>`;
  }

  function sequence(entity, entries) {
    return `<details class="seq"><summary>Tabella completa delle transizioni (${entries.length})</summary>
      <div class="scroll"><table class="tbl"><thead><tr><th scope="col">#</th><th scope="col">Stato</th><th scope="col">Data-ora</th><th scope="col">Trigger</th><th scope="col">Provenienza</th></tr></thead>
      <tbody>${entries.map((entry, index) => `<tr><td>${index + 1}</td><td>${badge(entry.state, '', entity)}</td><td>${time(entry)}</td>
        <td><code>${entry.trigger || 'Non disponibile'}</code></td><td>${basis(entry)}</td></tr>`).join('')}</tbody></table></div></details>`;
  }

  function render() {
    if (!scenario) {
      $('#head').innerHTML = '<h1>Dettaglio pagamento</h1>';
      $('#banners').innerHTML = '<div class="note err" role="alert">Scenario non disponibile. Scegli uno scenario di accettazione dai controlli demo.</div>';
      return;
    }
    const position = current(scenario.position);
    const unresolved = scenario.attempts.filter(attempt => UNRESOLVED.has(current(attempt.history)));
    $('#head').innerHTML = `<div class="page-head"><div><h1>Dettaglio pagamento</h1>
      <div class="idline"><div><span>Codice fiscale EC</span><b>00000000001</b></div><div><span>NAV</span><b>300000000000000001</b></div></div></div>
      <div class="status-summary"><span class="small muted">Stato posizione</span><strong id="position-current">${position}</strong>
      <span class="small">${stateMeaning(position, 'logical')}</span></div></div>`;
    $('#banners').innerHTML = `<div class="note">${icon('info')}<div><strong>${scenario.label}.</strong> ${scenario.note}</div></div>
      ${unresolved.length ? `<div class="note warn">${icon('warn')}<div><strong>${unresolved.length} tentativo non risolto.</strong> Warning solo visivo, associato al token: non cambia lo stato della posizione.</div></div>` : ''}
      ${scenario.attempts.some(attempt => attempt.history.some(entry => entry.basis === 'ANOMALY')) ? '<div class="note err">Anomalia temporale: stato conservato, data-ora non disponibile ed esclusa dai calcoli.</div>' : ''}`;
    $('#relationships').innerHTML = `<div class="relationship-grid">
      <div class="position-card"><span class="small muted">Pagamento logico · PA/NAV</span>${badge(position, '', 'logical')}
        <p>Fonte: storia della posizione. Nessuno stato ricavato contando i token.</p></div>
      <div><h3>Tentativi disponibili in retention: ${scenario.attempts.length}</h3>
        <p class="small muted">Non è il totale storico: ogni tentativo ha retention indipendente di 60 giorni.</p>
        <ul class="attempt-links">${scenario.attempts.map(attempt => `<li><a href="#attempt-${attempt.id}">Tentativo ${attempt.id}</a>
          ${badge(current(attempt.history))}</li>`).join('')}</ul></div></div>
      <p class="small muted">Le appartenenze alla posizione sono esplicite. Non attribuiamo le singole transizioni logiche ai token usando soltanto le date.</p>`;
    $('#semantics').innerHTML = UI.stateGuide();
    $('#logical').innerHTML = observedHistory('logical', scenario.position) + schema('logical', scenario.position) + sequence('logical', scenario.position);
    $('#att-title').textContent = `Tentativi disponibili in retention (${scenario.attempts.length})`;
    $('#attempts').innerHTML = scenario.attempts.map(attempt => {
      const state = current(attempt.history);
      return `<article class="attempt ${UNRESOLVED.has(state) ? 'unres' : ''}" id="attempt-${attempt.id}" tabindex="-1">
        <div class="attempt-h"><div class="l"><h3>Tentativo ${attempt.id}</h3>${badge(state)}</div><code class="tok">${attempt.token}</code></div>
        <div class="meta"><div><span>serviceIdentifier</span><b>${attempt.service}</b></div>
        <div><span>PSP</span><b>${attempt.psp}</b></div><div><span>Stazione</span><b>${attempt.station}</b></div>
        <div><span>Canale</span><b>${attempt.channel}</b></div><div><span>Avvio del tentativo</span><b>${attempt.started ? T(attempt.started, 'ms') : 'Data-ora non disponibile'}</b></div></div>
        <div class="attempt-actions"><button class="btn o sm" type="button" data-re-attempt="${attempt.id}">Recupera tentativo da RE</button></div>
        ${attempt.incomplete ? '<div class="note">Storia incompleta: avvio non disponibile, nessun evento precedente inventato.</div>' : ''}
        ${observedHistory('attempt', attempt.history)}${schema('attempt', attempt.history)}${sequence('attempt', attempt.history)}
        </article>`;
    }).join('');
    document.querySelectorAll('[data-re-attempt]').forEach(button => {
      button.addEventListener('click', () => {
        const attempt = scenario.attempts.find(item => item.id === button.dataset.reAttempt);
        UI.openReDetail({ paFiscalCode: '00000000001', noticeNumber: '300000000000000001', attempt }, button);
      });
    });
    $('#recipients').innerHTML = `<p class="small muted">Destinatari osservati per questa posizione: non sono associati ai singoli token senza una correlazione esplicita del servizio. Nessun totale atteso o percentuale di completamento viene dedotto.</p>
      ${scenario.recipients ? scenario.recipients.map(item => `<article class="attempt"><h3>Destinatario · stazione ${item.station}</h3>
        ${observedHistory('recipient', item.history)}${schema('recipient', item.history)}${sequence('recipient', item.history)}</article>`).join('')
        : '<div class="note note-spaced">Dati destinatari non disponibili in questo scenario. Questo non significa che non esistano destinatari.</div>'}`;
    UI.hydrateTimes();
  }

  document.addEventListener('shellready', () => {
    $('#demo-extra').innerHTML = `<label class="field"><span>Scenario di accettazione</span><select id="case">
      ${Object.entries(cases).map(([key, value]) => `<option value="${key}">${value.label}</option>`).join('')}</select></label>
      <button class="btn o sm" id="sim" type="button">Simula outcome positivo</button>
      <a class="linkbtn" id="scenario-link" href="?case=${scenario ? caseKey : 'unresolved'}">Link allo scenario iniziale</a>
      <a class="linkbtn" href="panoramica.html">Catalogo e criteri di accettazione</a>`;
    $('#case').value = scenario ? caseKey : '';
    $('#case').addEventListener('change', event => {
      caseKey = event.target.value;
      scenario = structuredClone(cases[caseKey]);
      const url = new URL(location.href);
      url.searchParams.set('case', caseKey);
      if (location.protocol !== 'file:') window.history.replaceState(null, '', url);
      $('#scenario-link').href = url.href;
      render();
    });
    $('#sim').addEventListener('click', () => {
      const attempt = scenario?.attempts.find(item => current(item.history) === 'PAYMENT_UNKNOWN');
      if (!attempt) {
        UI.toast('Nessun PAYMENT_UNKNOWN da risolvere nello scenario selezionato.');
        return;
      }
      const entry = { state: 'PAID', at: instant(300), basis: 'SOURCE_EVENT', trigger: 'sendPaymentOutcomeV2' };
      attempt.history.push({ ...entry });
      scenario.position.push({ ...entry });
      scenario.note = 'Outcome positivo simulato: warning risolto sul token, storia precedente conservata. La consegna della ricevuta è ancora distinta.';
      render();
      UI.toast('Simulazione locale: outcome positivo applicato. Nessuna richiesta inviata al Nodo.');
    });
    $('#live').textContent = 'Anteprima statica · aggiornamenti simulati';
    render();
  });
})();
