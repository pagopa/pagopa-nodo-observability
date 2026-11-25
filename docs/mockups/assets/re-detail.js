/* Local diagnostic prototype. Only synthetic events; no network or persistence. */
(() => {
  const { $, escape } = UI;
  const margin = 15 * 60 * 1000;
  const maxWindow = 24 * 60 * 60 * 1000;
  const pageSize = 4;
  let context;
  let opener;
  let timer;
  let events = [];
  let page = 0;

  const encode = text => btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join(''));
  const utcInput = value => new Date(value).toISOString().slice(0, 19);
  const sourceTime = value => new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
    hourCycle: 'h23'
  }).format(new Date(value)).replace(' ', 'T').replace(',', '.');

  function syntheticEvents() {
    const { attempt, paFiscalCode, noticeNumber } = context;
    const start = Date.parse(attempt.started || attempt.history.find(entry => entry.at)?.at);
    const definitions = [
      ['INTERFACCIA', 'REQ', 'activatePaymentNoticeV2', 'RICEVUTA', null,
        encode(`<activatePaymentNoticeV2><idPA>${paFiscalCode}</idPA><noticeNumber>${noticeNumber}</noticeNumber><paymentToken>${attempt.token}</paymentToken></activatePaymentNoticeV2>`)],
      ['INTERFACCIA', 'RESP', 'activatePaymentNoticeV2', 'INVIATA', null,
        encode('<response><message>Il pagamento è sintetico</message><script>window.RE_PAYLOAD_EXECUTED=true</script></response>')],
      ['INTERNO', 'INTERN', 'activatePaymentNoticeV2', 'CAMBIO_STATO', 'payment_PAYING', null],
      ['INTERNO', 'INTERN', 'activatePaymentNoticeV2', 'CAMBIO_STATO', 'position_PAYING', null],
      ['INTERNO', 'INTERN', 'sendPaymentOutcomeV2', 'CAMBIO_STATO', 'payment_NOTICE_GENERATED', null],
      ['INTERNO', 'INTERN', 'sendPaymentOutcomeV2', 'CAMBIO_STATO', 'receipt_recipient_NOTICE_SENT', '<base64>'],
      ['INTERFACCIA', 'REQ', 'paSendRTV2', 'INVIATA', null, '/w=='],
      ['INTERFACCIA', 'RESP', 'paSendRTV2', 'RICEVUTA', null, encode('{"outcome":"OK","note":"Esempio sintetico, non esito del tentativo corrente"}')]
    ];
    return definitions.map(([category, subtype, type, outcome, status, payload], index) => {
      const at = start + index * 1000;
      return {
        insertedTimestamp: new Date(at).toISOString().slice(0, -1),
        componente: 'FESP', categoriaEvento: category, sottoTipoEvento: subtype,
        idDominio: paFiscalCode, iuv: 'SYNTHETIC-IUV', ccp: attempt.token,
        psp: attempt.psp, tipoVersamento: null, tipoEvento: type,
        fruitore: attempt.channel, erogatore: 'NodoDeiPagamentiSPC',
        stazione: attempt.station, canale: attempt.channel,
        parametriSpecificiInterfaccia: null, esito: outcome,
        sessionId: 'SYNTHETIC-SESSION', status, payload,
        info: status?.startsWith('receipt_recipient_') ? 'stazione_recipient=00000000001_01' : null,
        businessProcess: type, fruitoreDescr: null, erogatoreDescr: 'NodoDeiPagamentiSPC',
        pspDescr: null, noticeNumber, creditorReferenceId: 'SYNTHETIC-IUV',
        paymentToken: attempt.token, sessionIdOriginal: null, standIn: null,
        serviceIdentifier: attempt.service, dataOraEvento: sourceTime(at),
        uniqueId: `SYNTHETIC-RE-${attempt.id}-${index + 1}`, version: '1'
      };
    });
  }

  function decodePayload(payload) {
    if (payload === null) return 'Payload assente (null).';
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
      return 'Base64 non valido: impossibile decodificare il payload. Il valore sorgente resta nei campi RE.';
    }
    const bytes = Uint8Array.from(atob(payload), character => character.charCodeAt(0));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      if (error.name !== 'TypeError') throw error;
      return 'UTF-8 non valido: il payload Base64 non contiene testo UTF-8 leggibile.';
    }
  }

  function selectEvent(index, moveFocus = false) {
    const event = events[index];
    $('#re-event-title').textContent = `Evento ${index + 1} · ${event.tipoEvento}`;
    $('#re-payload').textContent = decodePayload(event.payload);
    $('#re-fields').replaceChildren();
    for (const [name, value] of Object.entries(event)) {
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = name;
      description.textContent = value === null ? 'null' : String(value);
      $('#re-fields').append(term, description);
    }
    document.querySelectorAll('[data-re-event]').forEach(button => {
      button.setAttribute('aria-current', String(Number(button.dataset.reEvent) === index));
    });
    if (moveFocus) $('#re-payload').focus();
  }

  function renderPage() {
    const first = page * pageSize;
    const visible = events.slice(first, first + pageSize);
    $('#re-events').innerHTML = `<table class="tbl"><caption class="small">Timestamp inserimento RE originale · nel demo è UTC senza suffisso</caption>
      <thead><tr><th scope="col">Evento</th><th scope="col">Inserimento RE</th><th scope="col">Primitiva / categoria</th><th scope="col">Esito / status</th></tr></thead>
      <tbody>${visible.map((event, offset) => {
        const index = first + offset;
        return `<tr><td><button class="linkbtn" type="button" data-re-event="${index}" aria-label="Seleziona evento ${index + 1}">Evento ${index + 1}</button></td>
          <td><code>${escape(event.insertedTimestamp).replace('T', '<br>')}</code></td>
          <td><strong>${escape(event.tipoEvento)}</strong><br><span class="small">${escape(event.categoriaEvento)} · ${escape(event.sottoTipoEvento)}</span></td>
          <td>${escape(event.esito)}<br><code>${escape(event.status ?? 'null')}</code></td></tr>`;
      }).join('')}</tbody></table>`;
    $('#re-prev').disabled = page === 0;
    $('#re-next').disabled = first + pageSize >= events.length;
    $('#re-page').textContent = `${first + 1}–${first + visible.length} di ${events.length}`;
    document.querySelectorAll('[data-re-event]').forEach(button => {
      button.addEventListener('click', () => selectEvent(Number(button.dataset.reEvent), true));
    });
    selectEvent(first);
  }

  function clearResult() {
    clearTimeout(timer);
    events = [];
    $('#re-browser').hidden = true;
    $('#re-result').removeAttribute('aria-busy');
    $('#re-result').replaceChildren();
    $('#re-events').replaceChildren();
    $('#re-fields').replaceChildren();
    $('#re-payload').textContent = '';
  }

  function showMessage(text, kind = '') {
    const message = document.createElement('p');
    message.className = `note ${kind}`;
    message.textContent = text;
    $('#re-result').replaceChildren(message);
  }

  function retrieve() {
    clearResult();
    const from = Date.parse(`${$('#re-from').value}Z`);
    const to = Date.parse(`${$('#re-to').value}Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > maxWindow) {
      showMessage('Intervallo non valido: inserisci entrambe le date UTC, con Da precedente ad A e massimo 24 ore.', 'err');
      return;
    }
    const mode = $('#re-demo').value;
    $('#re-result').setAttribute('aria-busy', 'true');
    showMessage('Caricamento simulato degli eventi da RE…');
    timer = setTimeout(() => {
      $('#re-result').removeAttribute('aria-busy');
      if (mode === 'error') {
        showMessage('Errore simulato Data Explorer: sorgente non disponibile. Nessuno stato è stato modificato.', 'err');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn o sm';
        retry.textContent = 'Riprova';
        retry.addEventListener('click', retrieve);
        $('#re-result').append(retry);
        return;
      }
      // Demo timestamps are generated as UTC; the production ADX timezone must be verified.
      events = mode === 'empty' ? [] : syntheticEvents().filter(event => {
        const at = Date.parse(`${event.insertedTimestamp}Z`);
        return at >= from && at < to;
      });
      if (!events.length) {
        showMessage('Nessun evento corrispondente nell’intervallo. Questo non dimostra che il tentativo non esista né che RE sia completo.');
        return;
      }
      if (mode === 'limited') events = events.slice(0, 5);
      const summary = document.createElement('p');
      summary.className = mode === 'limited' ? 'note warn' : 'note';
      summary.textContent = mode === 'limited'
        ? 'Risultato limitato: limite demo raggiunto. La ricerca non è completa; restringi l’intervallo.'
        : `${events.length} eventi sintetici corrispondenti. Copertura del solo intervallo, non dell’intera storia.`;
      const metadata = document.createElement('p');
      metadata.className = 'small muted';
      metadata.textContent = `Intervallo interrogato: ${new Date(from).toISOString()} ≤ inserimento RE < ${new Date(to).toISOString()}. Recupero simulato: ${new Date().toISOString()}.`;
      $('#re-result').replaceChildren(summary, metadata);
      page = 0;
      $('#re-browser').hidden = false;
      renderPage();
    }, 100);
  }

  UI.openReDetail = (value, trigger) => {
    context = value;
    opener = trigger;
    clearResult();
    $('#re-demo').value = 'success';
    $('#re-context').innerHTML = [
      ['Codice fiscale PA', value.paFiscalCode], ['NAV', value.noticeNumber],
      ['paymentToken', value.attempt.token], ['serviceIdentifier', value.attempt.service]
    ].map(([label, text]) => `<div><dt>${escape(label)}</dt><dd>${escape(text)}</dd></div>`).join('');
    $('#re-dialog').showModal();
    if (!value.attempt.started) {
      $('#re-from').value = '';
      $('#re-to').value = '';
      $('#re-window-note').textContent = 'Nessuna finestra dedotta dai soli eventi successivi.';
      showMessage('Avvio del tentativo non disponibile: scegli esplicitamente un intervallo UTC prima di recuperare gli eventi.', 'warn');
      return;
    }
    const start = Date.parse(value.attempt.started);
    const last = Math.max(start, ...value.attempt.history.filter(entry => entry.at).map(entry => Date.parse(entry.at)));
    const from = start - margin;
    const proposedTo = Math.min(Date.now(), last + margin);
    const to = Math.min(proposedTo, from + maxWindow);
    $('#re-from').value = utcInput(from);
    $('#re-to').value = utcInput(to);
    $('#re-window-note').textContent = proposedTo > to
      ? 'Finestra ridotta alle prime 24 ore: non copre tutto il tentativo. Seleziona esplicitamente eventuali segmenti successivi.'
      : 'Finestra suggerita: avvio − 15 minuti / ultima transizione nota + 15 minuti, non oltre l’ora attuale. Modificabile in UTC.';
    retrieve();
  };

  document.addEventListener('DOMContentLoaded', () => {
    $('#re-form').addEventListener('submit', event => { event.preventDefault(); retrieve(); });
    $('#re-prev').addEventListener('click', () => { page--; renderPage(); });
    $('#re-next').addEventListener('click', () => { page++; renderPage(); });
    $('#re-close').addEventListener('click', () => $('#re-dialog').close());
    $('#re-dialog').addEventListener('cancel', event => { event.preventDefault(); $('#re-dialog').close(); });
    $('#re-dialog').addEventListener('close', () => {
      clearResult();
      $('#re-context').replaceChildren();
      context = undefined;
      opener?.focus();
      opener = undefined;
    });
  });
})();
