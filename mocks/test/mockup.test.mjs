import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import jsdom from 'jsdom';

const { JSDOM, VirtualConsole } = jsdom;

async function openMockup(t, page, query = '', protocol = 'http') {
  const url = new URL(`../../docs/mockups/${page}`, import.meta.url);
  let html = await readFile(url, 'utf8');
  for (const match of [...html.matchAll(/<script src="([^"]+)"(?: defer)?><\/script>/g)]) {
    const script = await readFile(new URL(match[1], url), 'utf8');
    html = html.replace(match[0], () => `<script>${script.replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  url.search = query;
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: protocol === 'file' ? url.href : `http://localhost/${page}${url.search}`,
    runScripts: 'dangerously',
    virtualConsole: console,
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.TextDecoder = TextDecoder;
      window.TextEncoder = TextEncoder;
      window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '');
        this.querySelector('[autofocus]')?.focus();
      };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open');
        this.dispatchEvent(new window.Event('close'));
      };
    },
  });
  t.after(() => dom.window.close());
  t.after(() => assert.deepEqual(errors, [], 'Interactions must not raise runtime errors'));
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  assert.deepEqual(errors, [], 'Mockup must render without runtime errors');
  return dom.window;
}

test('detail separates observed history from optional FSM paths and preserves reopened position visits', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html');
  const document = window.document;
  assert.match(document.querySelector('#relationships').textContent, /retention/);
  assert.equal(document.querySelector('#position-current').textContent, 'PAYING');
  assert.equal(document.querySelectorAll('#logical .observed-step').length, 3);
  assert.equal(document.querySelectorAll('#logical .observed-step[data-state="PAYING"]').length, 2);
  assert.match(document.querySelector('#logical').textContent, /Percorsi possibili/);
  assert.match(document.querySelector('#attempts').textContent, /non è un KO definitivo/);
  assert.equal(document.querySelectorAll('.tok').length, 2);
  assert.doesNotMatch(document.querySelector('#attempts').textContent, /••|Mostra token|non visibile/);
  assert.equal(document.querySelectorAll('[style], style').length, 0);
});

const finishReLoad = window => new Promise(resolve => window.setTimeout(resolve, 180));
const buttonByText = (document, text) => [...document.querySelectorAll('button')]
  .find(button => button.textContent.trim() === text || button.getAttribute('aria-label') === text);

test('RE opens a modal for the selected attempt with bounded UTC window and all source fields', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html');
  const document = window.document;
  const buttons = [...document.querySelectorAll('#attempts button')]
    .filter(button => button.textContent.includes('Recupera tentativo da RE'));
  assert.equal(buttons.length, 2);
  buttons[1].click();
  const dialog = document.querySelector('#re-dialog');
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent, /SYNTHETIC-TOKEN-A/);
  assert.match(dialog.textContent, /00000000001/);
  assert.match(dialog.textContent, /300000000000000001/);
  assert.match(document.querySelector('#re-result').textContent, /Caricamento/);
  const from = Date.parse(`${document.querySelector('#re-from').value}Z`);
  const to = Date.parse(`${document.querySelector('#re-to').value}Z`);
  assert.ok(to > from && to - from <= 86_400_000);
  await finishReLoad(window);
  assert.match(document.querySelector('#re-events').textContent, /INTERFACCIA/);
  assert.match(document.querySelector('#re-events').textContent, /INTERNO/);
  assert.equal(document.querySelectorAll('#re-fields dt').length, 33);
  const sourceFields = Object.keys(JSON.parse(await readFile(new URL('../../docs/analysis/re_messages.json', import.meta.url), 'utf8'))[0]);
  assert.deepEqual([...document.querySelectorAll('#re-fields dt')].map(term => term.textContent), sourceFields);
  assert.match(document.querySelector('#re-fields').textContent, /parametriSpecificiInterfaccia/);
  assert.match(document.querySelector('#re-fields').textContent, /null/);
  assert.match(document.querySelector('#re-payload').textContent, /<activatePaymentNoticeV2>/);
  document.querySelector('#re-next').click();
  assert.match(document.querySelector('#re-events').textContent, /receipt_recipient_/);
  assert.equal(document.querySelectorAll('[style], style').length, 0);
  document.querySelector('#re-close').click();
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, buttons[1]);
});

test('RE payload decoding preserves Unicode and renders markup as inert text', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html', 'case=paid');
  buttonByText(window.document, 'Recupera tentativo da RE').click();
  await finishReLoad(window);
  const document = window.document;
  buttonByText(document, 'Seleziona evento 2').click();
  const payload = document.querySelector('#re-payload');
  assert.match(payload.textContent, /pagamento è sintetico/);
  assert.match(payload.textContent, /<script>window.RE_PAYLOAD_EXECUTED=true<\/script>/);
  assert.equal(payload.querySelector('script'), null);
  assert.equal(window.RE_PAYLOAD_EXECUTED, undefined);
  buttonByText(document, 'Seleziona evento 3').click();
  assert.match(payload.textContent, /Payload assente/);
  document.querySelector('#re-next').click();
  buttonByText(document, 'Seleziona evento 6').click();
  assert.match(payload.textContent, /Base64 non valido/);
  buttonByText(document, 'Seleziona evento 7').click();
  assert.match(payload.textContent, /UTF-8 non valido/);
});

for (const [mode, expected] of [
  ['empty', /Nessun evento.*non dimostra/i],
  ['error', /Errore simulato.*Riprova/i],
  ['limited', /Risultato limitato.*non.*complet/i],
]) {
  test(`RE exposes ${mode} without changing the projection`, async t => {
    const window = await openMockup(t, '03-dettaglio-pagamento.html');
    const document = window.document;
    const initialState = document.querySelector('#position-current').textContent;
    buttonByText(document, 'Recupera tentativo da RE').click();
    await finishReLoad(window);
    document.querySelector('#re-demo').value = mode;
    document.querySelector('#re-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await finishReLoad(window);
    assert.match(document.querySelector('#re-result').textContent, expected);
    assert.equal(document.querySelector('#position-current').textContent, initialState);
  });
}

test('RE requires an explicit range for a missing start and rejects windows over 24 hours', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html', 'case=incomplete');
  const document = window.document;
  buttonByText(document, 'Recupera tentativo da RE').click();
  assert.match(document.querySelector('#re-result').textContent, /Avvio.*non disponibile.*intervallo/i);
  assert.equal(document.querySelector('#re-from').value, '');
  document.querySelector('#re-from').value = '2026-10-22T00:00';
  document.querySelector('#re-to').value = '2026-10-23T00:01';
  document.querySelector('#re-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.match(document.querySelector('#re-result').textContent, /massimo 24 ore/);
  document.querySelector('#re-from').value = '2026-10-23T07:45';
  document.querySelector('#re-to').value = '2026-10-23T08:15';
  document.querySelector('#re-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await finishReLoad(window);
  assert.ok(document.querySelector('#re-events table'));
});

test('RE cancels pending display updates on close and recovers after a simulated error', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html');
  const document = window.document;
  const open = buttonByText(document, 'Recupera tentativo da RE');
  open.click();
  document.querySelector('#re-close').click();
  await finishReLoad(window);
  assert.equal(document.querySelector('#re-result').textContent, '');
  open.click();
  document.querySelector('#re-demo').value = 'error';
  document.querySelector('#re-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await finishReLoad(window);
  document.querySelector('#re-demo').value = 'success';
  buttonByText(document, 'Riprova').click();
  await finishReLoad(window);
  assert.ok(document.querySelector('#re-events table'));
  document.querySelector('#re-dialog').dispatchEvent(new window.Event('cancel', { cancelable: true }));
  assert.equal(document.querySelector('#re-dialog').open, false);
});

test('RE uses inclusive start and exclusive end without silently broadening the chosen window', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html', 'case=accepted');
  const document = window.document;
  buttonByText(document, 'Recupera tentativo da RE').click();
  document.querySelector('#re-from').value = '2026-10-23T08:00:03';
  document.querySelector('#re-to').value = '2026-10-23T08:00:04';
  document.querySelector('#re-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await finishReLoad(window);
  assert.match(document.querySelector('#re-result').textContent, /1 eventi sintetici/);
  assert.match(document.querySelector('#re-events').textContent, /position_PAYING/);
  assert.doesNotMatch(document.querySelector('#re-events').textContent, /payment_NOTICE_GENERATED/);
  document.querySelector('#re-from').value = '2026-10-22T09:00';
  document.querySelector('#re-to').value = '2026-10-23T09:00';
  document.querySelector('#re-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await finishReLoad(window);
  assert.match(document.querySelector('#re-result').textContent, /8 eventi sintetici/);
  document.querySelector('#re-from').value = '2026-10-23T09:00';
  document.querySelector('#re-to').value = '2026-10-23T09:01';
  document.querySelector('#re-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await finishReLoad(window);
  assert.match(document.querySelector('#re-result').textContent, /Nessun evento/);
  assert.equal(document.querySelector('#re-from').value, '2026-10-23T09:00');
});

for (const [scenario, position, attempt, explanation] of [
  ['accepted', 'PAYING', 'PAYMENT_ACCEPTED', /in attesa dell.esito del pagamento/i],
  ['direct', 'PAID', 'PAID', /senza prenotazione e notifica PSP/i],
  ['failed', 'INSERTED', 'FAILED', /nuovo tentativo/i],
  ['partial', 'NOTIFIED', 'NOTICE_SENT', /tutti i destinatari/i],
  ['archived', 'NOTICE_STORED', 'NOTIFIED', /resta.*NOTICE_STORED/i],
  ['legacy', 'NOTICE_STORED', 'NOTICE_STORED', /PAID_NORPT/],
  ['incomplete', 'PAYING', 'PAYMENT_UNKNOWN', /storia incompleta/i],
]) {
  test(`acceptance scenario ${scenario} keeps entity states distinct`, async t => {
    const window = await openMockup(t, '03-dettaglio-pagamento.html', `case=${scenario}`);
    const document = window.document;
    assert.equal(document.querySelector('#position-current')?.textContent, position);
    assert.equal(document.querySelector('.attempt [aria-current="step"]')?.dataset.state, attempt);
    assert.match(document.querySelector('main').textContent, explanation);
    assert.equal(document.querySelectorAll('[data-entity="logical"] [data-from="NOTICE_STORED"][data-to="NOTIFIED"]').length, 0);
    assert.match(document.querySelector('main').textContent, /applicativo.*positivo/i);
    assert.equal(document.querySelectorAll('[style], style').length, 0);
  });
}

test('archived path is conditional and recipient history shows retry occurrences without token assignment', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html', 'case=archived');
  const document = window.document;
  assert.match(document.querySelector('#attempts').textContent, /applicabilità da confermare/i);
  assert.match(document.querySelector('#recipients').textContent, /non.*associati.*token/i);
  assert.equal(document.querySelectorAll('#recipients .observed-step[data-state="NOTICE_SENT"]').length, 2);
  assert.equal(document.querySelectorAll('#recipients .observed-step[data-state="NOTICE_PENDING"]').length, 1);
});

test('scenario selector updates the URL, while simulated resolution preserves history', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html');
  const select = window.document.querySelector('#case');
  assert.ok(select.options.length >= 9);
  window.document.querySelector('#sim').click();
  assert.equal(window.document.querySelector('#position-current').textContent, 'PAID');
  assert.equal(window.document.querySelectorAll('#logical .observed-step').length, 4);
  assert.equal(window.document.querySelectorAll('.attempt.unres').length, 0);
  select.value = 'accepted';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(new URL(window.location.href).searchParams.get('case'), 'accepted');
  assert.equal(window.document.querySelector('#position-current').textContent, 'PAYING');
});

test('unknown acceptance scenario is explicit rather than silently replaced', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html', 'case=missing');
  assert.match(window.document.querySelector('[role="alert"]').textContent, /scenario.*non disponibile/i);
});

test('scenario selection also works when the mockup is opened directly as a file', async t => {
  const window = await openMockup(t, '03-dettaglio-pagamento.html', '', 'file');
  const select = window.document.querySelector('#case');
  select.value = 'archived';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(window.document.querySelector('#position-current').textContent, 'NOTICE_STORED');
  assert.equal(new URL(window.document.querySelector('#scenario-link').href).searchParams.get('case'), 'archived');
});

test('list filters expose all attempt states and entity-specific labels', async t => {
  const window = await openMockup(t, '02-pagamenti.html', 'entita=tentativo');
  const document = window.document;
  assert.match(document.querySelector('label:has(#f-stato)').textContent, /Stato tentativo/);
  assert.equal(document.querySelectorAll('#f-stato option').length, 19);
  assert.ok(document.querySelectorAll('#f-stato optgroup').length > 1);
  assert.equal(document.querySelector('#m-token').disabled, false);
  assert.match(document.querySelector('#res thead').textContent, /Stato tentativo/);
});

test('empty state filters do not fall back to unrelated rows', async t => {
  const window = await openMockup(t, '02-pagamenti.html', 'entita=tentativo&stato=FAILED_NORPT');
  assert.match(window.document.querySelector('#res').textContent, /Nessun risultato/);
});

test('attempt token identities remain stable when filtering by current state', async t => {
  const unfiltered = await openMockup(t, '02-pagamenti.html', 'entita=tentativo');
  const filtered = await openMockup(t, '02-pagamenti.html', 'entita=tentativo&stato=PAID');
  const paidToken = window => [...window.document.querySelectorAll('#res tbody tr')]
    .find(row => row.textContent.includes('301987654321098765')
      && [...row.querySelectorAll('.badge')].at(-1)?.textContent === 'PAID')
    ?.querySelector('.tok')?.textContent;
  assert.ok(paidToken(unfiltered));
  assert.equal(paidToken(filtered), paidToken(unfiltered));
});

for (const page of ['index.html', '04-enti-creditori.html', '05-dettaglio-ente.html']) {
  test(`${page} explains acceptance, payment and delivery without merging the entities`, async t => {
    const window = await openMockup(t, page);
    assert.match(window.document.querySelector('#state-guide').textContent, /PAYMENT_ACCEPTED/);
    assert.match(window.document.querySelector('#state-guide').textContent, /NOTIFIED/);
    assert.match(window.document.querySelector('#state-guide').textContent, /applicativo.*positivo/i);
  });
}
