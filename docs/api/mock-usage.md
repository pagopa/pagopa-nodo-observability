# Mock API osservabilità pagamenti: uso e contratto

Il contratto normativo è `docs/api/openapi.json` (OpenAPI 3.1). Questo documento spiega come usare il mock locale in `mocks/`.

## Perimetro e avvertenze

* Dati sintetici, piccoli e coerenti, tenuti solo in memoria. Nessun database e nessun Event Hubs: il mock non simula la pipeline reale.
* Il runtime usa solo moduli built-in di Node (nessuna dipendenza a runtime) e si lega esclusivamente a `127.0.0.1`. Le risposte hanno `Cache-Control: no-store`.
* L'autenticazione è fittizia, valida solo in localhost, **non** per la produzione.
* Nessun CORS: un header `Origin` è accettato solo se identico a `http://${Host}` della richiesta; qualunque altra origine riceve `403 FORBIDDEN` senza header CORS. Il proxy Angular di sviluppo inoltra le richieste a `http://127.0.0.1:3001` e rimuove `Origin` con il callback `configure`/evento `proxyReq`. `changeOrigin: true` da solo cambia `Host`, non `Origin`, e non è sufficiente.
* Prerequisiti: Node >= 22 e `npm install` (le dipendenze servono solo a `contract:validate` e ai test, non al server). Nell'ambiente di sviluppo corrente lo shim `/opt/homebrew/bin/node` non funziona: usare `PATH=/opt/homebrew/Cellar/node/26.8.2/bin:$PATH npm install` e lo stesso prefisso per gli script. Su altre macchine usare il percorso della propria installazione Node funzionante.
* Porta: `PORT` (default `3001`); `MOCK_NOW` (ISO UTC) rende deterministico il dataset.
* Le date sono relative all'avvio; con `MOCK_NOW` (ISO UTC) il dataset è deterministico.
* Sola lettura: i POST funzionali sono `reveal`, `token-lookup` e la consultazione diagnostica `re-events`; `/__mock/*` esiste solo nel mock (tag `mock-only`).

## Script

| Comando | Descrizione |
| --- | --- |
| `npm start` | Avvia Angular CLI (`ng serve`) e il proxy locale verso `127.0.0.1:3001`. |
| `npm run mock` | Avvia `mocks/server.mjs`. |
| `npm test` | Esegue i test Angular in modalità non interattiva. |
| `npm run test:mock` | Esegue `node --test mocks/test/*.test.mjs`. |
| `npm run lint` | Esegue ESLint con angular-eslint. |
| `npm run build` | Compila l'applicazione Angular standalone. |
| `npm run contract:validate` | Valida l'OpenAPI con swagger-parser e verifica che ogni schema compili con Ajv 2020-12. |

Avvio locale completo, in due terminali:

```bash
PATH=/opt/homebrew/Cellar/node/26.8.2/bin:$PATH npm run mock
PATH=/opt/homebrew/Cellar/node/26.8.2/bin:$PATH npm start
```

Aprire `http://localhost:4200`. Il proxy rimuove l'header `Origin` per le chiamate al mock; `changeOrigin` da solo non rispetta il controllo d'origine del server.

`mocks/validate-contract.mjs` esporta `loadContract()` (documento dereferenziato) e `createResponseValidator(contract)`, che restituisce `validate(method, path, status, body)`: individua la rotta con template (`/api/payments/{paFiscalCode}/{noticeNumber}`), verifica che lo status sia dichiarato e che il body JSON rispetti lo schema; lancia un errore altrimenti. Le risposte `text/event-stream` non sono validate; gli schemi degli eventi (`PaymentDelta`, `AggregateDelta`, `ReadyEvent`, `EventScope`) sono in `components.schemas` e possono essere compilati con Ajv a partire dal documento.

## Check DB per tentativo

`GET /api/attempts/{attemptId}/check-db` è disponibile a tutti gli utenti
autenticati nel proprio perimetro, senza privilegi di reveal. Non accetta
parametri: servizio, token e coppia PA/NAV vengono risolti dal tentativo sul
server. Le risposte non contengono token, credenziali, payload o dati aggiuntivi
del pagamento e non sono memorizzabili in cache.

Il mock **non accede a nodo-online**. Restituisce sempre `source: "SIMULATED"`;
solo il backend reale può restituire `NODO_ONLINE`. La risposta contiene
identità, `serviceIdentifier`, `checkedAt` UTC, `projectionRevision` confrontata,
`observed: { logicalState, attemptState }` e
`database: { logicalState, attemptState }`. Un valore DB `null` indica record
assente, non successo o stato coincidente. Il confronto riguarda uguaglianza
degli stati delle rispettive entità, non l'esito applicativo del pagamento.
Non vengono aggiornati proiezione, timeline o warning.

Per impostare lo scenario globale del mock:

```bash
curl -s -X POST http://127.0.0.1:3001/__mock/control \
  -H 'Authorization: Bearer DEMO_ADMIN' -H 'Content-Type: application/json' \
  -d '{"action":"checkDb","scenario":"mismatch"}'
curl -s http://127.0.0.1:3001/api/attempts/att_001_1/check-db \
  -H 'Authorization: Bearer DEMO_VIEWER'
```

| Scenario | Risposta |
| --- | --- |
| `match` (iniziale) | Stati DB sintetici uguali a quelli osservati al momento della richiesta |
| `mismatch` | Stati DB sintetici diversi per entrambe le entità |
| `missing` | Entrambi i record DB assenti (`null`) |
| `unconfigured` | `422 DB_SERVICE_UNCONFIGURED` |
| `unavailable` | `503 DB_UNAVAILABLE` |

Il controllo di un tentativo senza servizio restituisce sempre
`422 DB_SERVICE_MISSING`; un tentativo assente, non visibile o scaduto restituisce
`404 NOT_FOUND`. I controlli esistenti `delay` e `failure` si applicano anche a
questo endpoint. Lo scenario non modifica le fixture e si azzera al riavvio.
Il frontend avvia il controllo solo al click; se riceve una nuova revisione
della proiezione, marca il confronto precedente come da ripetere senza
rieseguirlo automaticamente.

## Recupero diagnostico RE per tentativo

`POST /api/attempts/{attemptId}/re-events` accetta esclusivamente
`{ "from": "<UTC>", "to": "<UTC>", "cursor": "<opzionale>" }`, senza query string.
La finestra è semiaperta `[from,to)`, con massimo 24 ore. PA, NAV e token sono
risolti sul server dal tentativo; i tre vincoli si applicano congiuntamente.
Nessun filtro su categoria, primitiva, esito o stato, nessuna espansione per
sessione/CCP/IUV. Eventi senza una delle chiavi non vengono recuperati.

La risposta contiene `attemptId`, `source: "RE"`, `retrievedAt`, `window`,
`coverage`, `events`, `nextCursor`, `truncated`, `warnings`. **Nel mock ogni
risposta dichiara la simulazione nei warnings; non contatta ADX.** Il campione
sintetico contiene anche eventi `INTERFACCIA` `REQ` e `RESP` con
`tipoEvento = paSendRT` e `businessProcess = sendPaymentOutcome`, per distinguere
la chiamata RE dalla provenienza dei cambi di stato. Il dettaglio pagamento può
mostrare questi eventi in una traccia RE separata, caricata su richiesta: non
sono aggiunti alla timeline della proiezione.
La retention RE sintetica è 30 giorni, distinta dai 60 giorni console.
`RETENTION_CLIPPED` indica estremi ridotti alla retention/ora di recupero.
Intervalli validi ma completamente esterni ricevono 200 vuoto e warning
`OUTSIDE_RETENTION` oppure `OUTSIDE_AVAILABLE_WINDOW`, senza interrogare la
sorgente; la finestra restituita resta quella richiesta, non un'intersezione
valida o una prova di assenza dei dati. Un tentativo conosciuto scaduto
riceve 410; assente/non visibile 404, senza ricerca alternativa.

Ogni evento conserva tutti i 33 campi sorgente, null espliciti, tipi scalari
e timestamp originali. `payloadDecoded: {status,text,reason}` distingue
`ABSENT`, `DECODED`, `INVALID_BASE64`, `INVALID_UTF8`, `TOO_LARGE`.
Oltre 256 KiB decodificati anche il Base64 è omesso: `payloadOmitted: true`,
`payloadSourceBytes` esplicito e `payload: null`, mai interpretato come assente.
Il browser mostra solo testo, senza eseguire XML/HTML o caricare risorse.

Le pagine contengono al massimo 100 eventi; il cursore firmato scade dopo
5 minuti ed è vincolato a utente, tentativo, finestra e snapshot iniziale.
Lo scenario successivo non altera le pagine di un recupero già iniziato.
A 1.000 eventi il mock dichiara `LIMIT_REACHED`, `truncated: true` e nessun
cursore successivo. Nessun fan-out verso altri intervalli.

Per cambiare scenario inviare a `/__mock/control`:
`{ "action": "reEvents", "scenario": "limit" }`.
Scenari: `success` (iniziale, tutte le categorie, stati sconosciuti e casi
payload), `empty`, `limit`, `error` (502), `unconfigured` (503),
`timeout` (504), `throttled` (429). `delay` simula anche il caricamento RE.
Il risultato non modifica proiezione, Check DB o SSE. Tutte le risposte,
inclusi gli errori, hanno `Cache-Control: no-store`. Non vengono persistiti
payload o contenuti diagnostici; l'audit mock esistente dei token resta separato.

In Angular il dialog viene aperto dal tentativo selezionato; la prima lettura
e ogni pagina sono esplicite, senza polling. Edit delle date, nuovo recupero
e chiusura annullano le richieste pendenti. Non sono usati storage o URL per
memorizzare la consultazione. Un risultato vuoto non certifica l'assenza del
tentativo, e nessuna copertura dichiara la storia completa.

Il backend reale è disabilitato per default: consultare il README backend
per le configurazioni e i gate ADX/protezioni dati necessari all'attivazione.
Le fixture non costituiscono verifica dello schema o della retention reali.
Il backend distingue 410 solo finché il record scaduto è disponibile nel
repository: dopo la cancellazione fisica, un ID scaduto non è distinguibile
da un ID mai acquisito e riceve 404. Nessuna ricerca RE alternativa viene avviata.
L'annullamento browser non garantisce l'interruzione immediata del lavoro ADX;
timeout ed executor limitano comunque il lavoro pendente. Cursori e quote
backend sono per processo: più repliche richiedono routing coerente e quote
condivise, come descritto nel README backend.

## Autenticazione e ruoli

Header `Authorization: Bearer <token demo>`.

| Token | Ruolo | Permessi |
| --- | --- | --- |
| `DEMO_VIEWER` | Lettura | Tutte le letture, `paymentToken` in chiaro. |
| `DEMO_OPERATOR` | Operatore | Letture, `reveal` e `token-lookup`. |
| `DEMO_PA_VIEWER` | Lettura limitata | Letture solo per l'ente `00000000001`, `paymentToken` in chiaro. |
| `DEMO_ADMIN` | Amministratore | Come operatore, più `/__mock/control` e `/__mock/audit`. |

Il `paymentToken` compare in chiaro nel campo `tokenDisplay` di tutte le letture REST e negli upsert SSE per ogni utente autenticato, senza distinzione di ruolo. Gli accessi non autenticati restano negati. Le operazioni di `reveal` e `token-lookup` richiedono `OPERATOR`/`ADMIN`; sono registrate in audit senza memorizzare il token. Risposte di errore, cursori e log non contengono il token; il token cercato viaggia solo nel body di `token-lookup`.

## Workflow con curl

```bash
BASE=http://127.0.0.1:3001   # PORT, default 3001
H_OP="Authorization: Bearer DEMO_OPERATOR"

curl -s $BASE/health
curl -s -H "$H_OP" $BASE/api/me
curl -s -H "$H_OP" $BASE/api/catalog
curl -s -H "$H_OP" $BASE/api/freshness

# lista paginata e cursore
curl -s -H "$H_OP" "$BASE/api/payments?pageSize=2&unresolvedOnly=true"
curl -s -H "$H_OP" "$BASE/api/payments?pageSize=2&unresolvedOnly=true&cursor=<nextCursor>"

# dettaglio pagamento logico e tentativi
curl -s -H "$H_OP" $BASE/api/payments/00000000001/300000000000000001

# rivelazione token (OPERATOR/ADMIN) e ricerca per token
curl -s -X POST -H "$H_OP" -H 'Content-Type: application/json' -d '{}' $BASE/api/attempts/att_001_1/reveal
curl -s -X POST -H "$H_OP" -H 'Content-Type: application/json' \
  -d '{"paymentToken":"SYNTHETIC-TOKEN-1-1","paFiscalCode":"00000000001","noticeNumber":"300000000000000001"}' $BASE/api/token-lookup

# dashboard (finestra semiaperta [from,to), default ultima ora)
curl -s -H "$H_OP" "$BASE/api/overview?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z"
curl -s -H "$H_OP" "$BASE/api/overview?psp=ABI00001"
curl -s -H "$H_OP" "$BASE/api/overview?psp=~unknown"

# enti e stazioni
curl -s -H "$H_OP" $BASE/api/creditors
curl -s -H "$H_OP" $BASE/api/creditors/00000000001
curl -s -H "$H_OP" "$BASE/api/creditors/00000000001/stations?pageSize=1"

# audit (solo ADMIN): { "items": [ { actorId, action, attemptId, recordedAt } ] }
curl -s -H "Authorization: Bearer DEMO_ADMIN" $BASE/__mock/audit
```

## Controlli mock (`POST /__mock/control`)

Solo `DEMO_ADMIN`, senza query string, `Content-Type: application/json`, corpo massimo 4096 byte. Ogni azione accetta **solo** i campi indicati (altri → `400`); non ci sono default, tutti i campi elencati sono obbligatori. Risposta `200`: `{ "action", "projectionRevision", "now" }`. I controlli non sono soggetti a `failure` né a `delay`.

| Azione | Campi | Effetto |
| --- | --- | --- |
| `resolve` | `attemptId` (string) | Richiede pagamento logico `PAYING`. Solo per tentativi in `PAYMENT_UNKNOWN` (→ `PAID`, pagamento `PAID`, trigger sintetico `sendPaymentOutcome`) o `PAYMENT_SEND_ERROR` (→ `CANCELLED`, pagamento `INSERTED`, trigger `sendPaymentResult-v2`); altrimenti `400`, id sconosciuto `404`. Pubblica i delta. Per percorsi diversi usare `scenario`. |
| `gap` | `attemptId` | Come `resolve`, ma il `payment.delta` è soppresso per i subscriber `payment` e segue una seconda revisione con `timelineIncomplete: true`: salto di revisione. |
| `scenario` | `attemptId`, `scenario` (stringhe) | Esegue un passo del catalogo FSM descritto sotto, con provenienza esplicita. Precondizioni non rispettate/scenario sconosciuto → `400`, tentativo sconosciuto → `404`. Non accetta stato o trigger arbitrari. |
| `createAttempt` | `paFiscalCode`, `noticeNumber` | Crea il prossimo tentativo deterministico solo su un pagamento logico `INSERTED` (altrimenti `400`, pagamento sconosciuto `404`). Fixture iniziale: `00000000001/300000000000000003`. Metadati completi, avvio `clock()` con base `SOURCE_EVENT`, timeline `PAYING`; il pagamento passa a `PAYING`. Delta con upsert completo (`tokenDisplay` in chiaro per gli utenti autenticati) e append logico. |
| `completeDimensions` | `attemptId` | Completa solo `psp`, `stazione`, `canale` mancanti con valori sintetici deterministici; valori presenti invariati. Delta con patch sparsa e `transitions: []`. Tentativo sconosciuto `404`; nessuna modifica → nessuna nuova revisione né delta, anche alla ripetizione. |
| `correctTimestamps` | `attemptId` | Corregge avvio e transizioni `INFERRED`/`ANOMALY` a `SOURCE_EVENT`, senza cambiare lo stato. Invia patch e correzioni per indice, non append; azzera `timelineIncomplete` del tentativo e ricalcola quello del pagamento dai tentativi. Corregge anche la prima transizione logica delle fixture 7/8. Tentativo sconosciuto `404`; ripetizione senza modifiche → nessuna nuova revisione né delta. |
| `duplicate` | nessuno | Riscrive, con lo stesso `id`, l'ultimo evento di ogni client SSE che ne ha ricevuto uno. |
| `advanceClock` | `milliseconds` (intero 0..31536000000) | Avanza l'orologio e rimuove i tentativi oltre i 60 giorni (delta con `removedAttemptIds`/`deleted`). |
| `empty` | `enabled` (boolean) | `true`: letture vuote e `deleted: true`, che elimina il dettaglio locale. `false`: `deleted: false`, timeline logica completa in `logicalTransitions`, `timelineIncomplete` esplicito e upsert completi di tutti i tentativi (`transitions: []`); ricostruisce il dettaglio cancellato senza GET. Se il valore è già impostato, nessuna nuova revisione né delta. |
| `failure` | `enabled` | Ogni `/api/*` risponde `500 MOCK_FAILURE` (non `/health`). |
| `delay` | `milliseconds` (intero 0..2000) | Ritardo su ogni `/api/*`. |
| `auditFailure` | `enabled` | `reveal` e `token-lookup` rispondono `500 AUDIT_UNAVAILABLE`. |
| `expireReplay` | nessuno | Svuota lo storico: i `Last-Event-ID` precedenti danno `410 SSE_CURSOR_EXPIRED`. |
| `freshness` | `status` (`CURRENT`\|`DELAYED`\|`GAP`), `lagSeconds` (intero >= 0), `gapsDetected` (boolean) | Imposta la freschezza e pubblica un `aggregate.delta` vuoto. |

```bash
A="Authorization: Bearer DEMO_ADMIN"; J='Content-Type: application/json'
ctl() { curl -s -X POST -H "$A" -H "$J" -d "$1" $BASE/__mock/control; echo; }

ctl '{"action":"resolve","attemptId":"att_001_1"}'      # PAYMENT_UNKNOWN -> PAID
ctl '{"action":"gap","attemptId":"att_004_1"}'          # PAYMENT_SEND_ERROR -> CANCELLED + salto di revisione
ctl '{"action":"createAttempt","paFiscalCode":"00000000001","noticeNumber":"300000000000000003"}'
ctl '{"action":"completeDimensions","attemptId":"att_008_1"}'
ctl '{"action":"completeDimensions","attemptId":"att_008_1"}' # no-op, stessa revisione
ctl '{"action":"correctTimestamps","attemptId":"att_007_1"}'
ctl '{"action":"correctTimestamps","attemptId":"att_008_1"}'
ctl '{"action":"correctTimestamps","attemptId":"att_008_1"}'   # no-op, stessa revisione
ctl '{"action":"duplicate"}'
ctl '{"action":"advanceClock","milliseconds":86400000}'
ctl '{"action":"empty","enabled":true}'
ctl '{"action":"empty","enabled":false}'
ctl '{"action":"failure","enabled":true}'
ctl '{"action":"failure","enabled":false}'
ctl '{"action":"delay","milliseconds":500}'
ctl '{"action":"delay","milliseconds":0}'
ctl '{"action":"auditFailure","enabled":true}'
ctl '{"action":"auditFailure","enabled":false}'
ctl '{"action":"expireReplay"}'
ctl '{"action":"freshness","status":"DELAYED","lagSeconds":120,"gapsDetected":true}'
```

Scenari tipici: stato irrisolto → `resolve` e verifica del delta; salto di revisione → `gap`; evento duplicato → `duplicate` (deduplicare per `id`); retention → `advanceClock` di oltre 60 giorni; viste vuote/errore/lente → `empty`/`failure`/`delay`; audit negato → `auditFailure` poi `reveal` (`500`); riconnessione fallita → `expireReplay` poi `Last-Event-ID` (`410`); banner di ritardo → `freshness`. Il dataset si ripristina riavviando il mock.

### Scenari FSM interattivi

Il catalogo è in `mocks/scenarios.mjs`; l'enum del campo `scenario` è anche nell'OpenAPI. Sono mantenuti gli 8 pagamenti iniziali e i relativi identificativi. Ogni passo verifica **entrambi** gli stati di partenza prima di modificare i dati; non è un endpoint per impostare liberamente uno stato.

### Contratto destinatari e limiti di correlazione

Il dettaglio restituisce sempre `recipients`; panoramica ed ente restituiscono
`recipientStates` e `matrices.recipient` (stazione destinatario, anche nulla).
Trend e durate distinguono `entity: recipient`. I destinatari sono record della
posizione PA/NAV: filtri di tentativo selezionano le posizioni interessate ma
non certificano che un destinatario appartenga al token filtrato. Non esiste
un drill-down destinatario o un denominatore atteso dedotto dal client.

Ogni record espone `recipientId`, `stazioneRecipient`, PA/NAV, stato,
`timelineIncomplete`, `hasAnomaly`, timeline e revisione; nessun payload,
`attemptId`, ruolo intestatario o completezza del set. Un array vuoto significa
nessun record disponibile in retention, non contratto assente. Il backend
non può omettere i campi per mascherare una funzionalità indisponibile.

I delta `recipientChanges` seguono upsert completi, patch e correzioni a
indici stabili prima degli append; `removedRecipientIds` elimina record interi.
Tutte le revisioni del dettaglio, inclusi destinatari non modificati, avanzano
insieme. I retry non vengono collassati e le date non riordinano la storia.
La retention destinatario è autonoma a 60 giorni dal primo evento disponibile
(prima elaborazione se anomalo), mai prorogata dal retry; l'ultima scadenza dei
tentativi elimina anche il pagamento e i destinatari residui. Non eliminare
un destinatario solo perché scade uno dei diversi tentativi della posizione.
Il cleanup invalida anche le copie di replay.

Le fixture e i controlli specificano il `trigger` esplicitamente, senza ricavarlo dallo stato finale. Il valore è presente anche nelle timeline logiche, nelle correzioni temporali e nei delta SSE. È una provenienza sintetica coerente con il flusso scelto, non una diagnosi: ad esempio nel ramo ricevuta V2 si mantiene `sendPaymentOutcomeV2`, come nei campioni RE, anziché sostituirlo con `paSendRTV2`. L'assenza di un trigger in una risposta esterna resta «non disponibile» nella UI.

| `scenario` | Stato tentativo iniziale → finale | Stato logico iniziale → finale | Trigger sintetico |
| --- | --- | --- | --- |
| `nm3OutcomeOk` | `PAYING → PAID` | `PAYING → PAID` | `sendPaymentOutcomeV2` |
| `nm3OutcomeKo` | `PAYING → FAILED` | `PAYING → INSERTED` | `sendPaymentOutcomeV2` |
| `closeOk` | `PAYING` / `PAYING_RPT → PAYMENT_RESERVED` | resta `PAYING` | `closePayment-v2` |
| `closeKo`, `closeInvalid` | `PAYING` / `PAYING_RPT → CANCELLED` | `PAYING → INSERTED` | `closePayment-v2` |
| `pspSend` | `PAYMENT_RESERVED → PAYMENT_SENT` | resta `PAYING` | `pspNotifyPaymentV2` |
| `pspAccepted` | `PAYMENT_SENT → PAYMENT_ACCEPTED` | resta `PAYING` | `pspNotifyPaymentV2` |
| `pspRefused` | `PAYMENT_SENT → PAYMENT_REFUSED` | resta `PAYING` | `pspNotifyPaymentV2` |
| `pspUnknown` | `PAYMENT_SENT → PAYMENT_UNKNOWN` | resta `PAYING` | `pspNotifyPaymentV2` |
| `pspSendError` | `PAYMENT_SENT → PAYMENT_SEND_ERROR` | resta `PAYING` | `pspNotifyPaymentV2` |
| `outcomeOk` | `PAYMENT_ACCEPTED` / `PAYMENT_UNKNOWN → PAID` | `PAYING → PAID` | `sendPaymentOutcomeV2` |
| `resultKo` | `PAYMENT_REFUSED` / `PAYMENT_SEND_ERROR → CANCELLED` | `PAYING → INSERTED` | `sendPaymentResult-v2` |
| `expireUnknown` | `PAYMENT_UNKNOWN → CANCELLED` | `PAYING → INSERTED` | `mod3CancelV2` |
| `generateReceipt` | `PAID → NOTICE_GENERATED` | resta `PAID` | `sendPaymentOutcomeV2` |
| `sendReceipt` | `NOTICE_GENERATED → NOTICE_SENT` | resta `PAID` | `sendPaymentOutcomeV2` |
| `primaryResponse` | resta `NOTICE_SENT` | `PAID → NOTIFIED` | `sendPaymentOutcomeV2` |
| `completeReceipt` | `NOTICE_SENT → NOTIFIED` | `PAID → NOTIFIED` oppure resta `NOTIFIED` | `sendPaymentOutcomeV2` |
| `receiptTimeout`, `retryReceipt` | resta `NOTICE_SENT` | resta `PAID` / `NOTIFIED` / `NOTICE_STORED` | destinatario `NOTICE_SENT → NOTICE_PENDING → NOTICE_SENT`, `paSendRTV2` / `RetryPaSendRtActor` |
| `retryResult` | resta `CANCELLED` | invariato, qualunque stato logico già presente | nessuna transizione funzionale |
| `legacyOutcomeOkNoRpt` | `PAYING → PAID_NORPT` | `PAYING → PAID` | `sendPaymentOutcome` |
| `legacyPaidComplete` | `PAID_NORPT → PAID` | resta `PAID` | `NodoInviaRPT` |
| `legacyGenerateReceipt` | `PAID → NOTICE_GENERATED` | resta `PAID` | `NodoInviaRPT` |
| `legacyStoreReceipt` | `NOTICE_GENERATED → NOTICE_STORED` | `PAID → NOTICE_STORED` | `NodoInviaRPT` |
| `outcomeStoreReceipt` | `PAYING` / `PAYING_RPT` / `PAYMENT_ACCEPTED` / `PAYMENT_UNKNOWN → PAID → NOTICE_GENERATED → NOTICE_STORED` | `PAYING → PAID → NOTICE_STORED` | `sendPaymentOutcomeV2`, ramo con RPT |

Gli scenari ricevuta attestano condizioni sintetiche già soddisfatte nel Nodo:
`primaryResponse` simula una risposta intellegibile della PA intestataria,
`completeReceipt` tutte le risposte necessarie, **anche applicativamente KO**.
Il set sintetico di due destinatari non certifica la completezza dei dati reali:
la UI non ne deduce un rapporto notificati/attesi né un legame al token.
Timeout e retry aggiornano solo i destinatari e pubblicano revisioni/delta,
conservando tutte le occorrenze; `retryResult` resta un no-op tecnico.
La guardia della posizione promuove a `NOTIFIED` solo da `PAID`, mai da
`NOTICE_STORED`. `outcomeStoreReceipt` è distinto dalla RPT tardiva:
non abilita l'invio da tentativo archiviato, il cui gate Nodo resta aperto.

`expireUnknown` simula un annullo **già autorizzato dal Nodo**: non modella gruppi NMU, scadenze token, flag `busy` o gare con l'outcome. `advanceClock` continua a riguardare solo la retention dei dati e non annulla pagamenti. `closeInvalid` simula l'annullo di un token conosciuto coinvolto nella validazione; non crea record per token sconosciuti.

Non vengono introdotti ingressi non verificati in `PAYING_RPT`/`CANCELLED_NORPT`, alias `payment_UNKNOWN` o lo stato logico `CANCELLED`. La fixture 5 ora rappresenta un outcome anticipato senza RPT e il successivo completamento `NodoInviaRPT`, compresa la generazione prima della conservazione. Le fixture 1 e 7 mantengono il ramo V1, 2/4/6 includono provenienze V2; il catalogo interattivo principale usa V2 e il ramo legacy usa le provenienze indicate.

Esempio completo sul dataset appena avviato, con stream della fixture 3 aperto:

```bash
ctl '{"action":"createAttempt","paFiscalCode":"00000000001","noticeNumber":"300000000000000003"}'
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"closeOk"}'
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"pspSend"}'
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"pspUnknown"}'
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"outcomeOk"}'
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"generateReceipt"}'
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"sendReceipt"}'
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"receiptTimeout"}' # delta solo destinatari
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"retryReceipt"}'   # nessun delta
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"primaryResponse"}'
ctl '{"action":"scenario","attemptId":"att_003_2","scenario":"completeReceipt"}'
```

Percorsi alternativi, ciascuno dopo riavvio e `createAttempt` sulla fixture 3:

* **NM3 diretto:** `nm3OutcomeOk` oppure `nm3OutcomeKo`, senza passaggi close/PSP.
* **Rifiuto PSP:** `closeOk → pspSend → pspRefused → resultKo`.
* **Errore invio PSP:** `closeOk → pspSend → pspSendError → resultKo`.
* **Scadenza autorizzata:** `closeOk → pspSend → pspUnknown → expireUnknown`.
* **PSP accettato:** `closeOk → pspSend → pspAccepted → outcomeOk`; non è accettabile il KO NM3 da `PAYMENT_ACCEPTED`.
* **Close KO / validazione:** `closeKo` oppure `closeInvalid`.
* **Legacy senza RPT:** `legacyOutcomeOkNoRpt → legacyPaidComplete → legacyGenerateReceipt → legacyStoreReceipt`.

Dopo `FAILED`/`CANCELLED`, la posizione `INSERTED` consente un nuovo `createAttempt` (`att_003_3`, poi successivi), mantenendo lo storico. Uno scenario finanziario su un tentativo già terminale è rifiutato, senza delta o modifiche parziali. `PAID` non è terminale per la storia della ricevuta.

### Scenari di aggiornamento senza rilettura

Aprire lo stream della coppia interessata e acquisire lo snapshot iniziale prima dei controlli:

* **Nuovo tentativo**: sulla fixture 3 (`00000000001/300000000000000003`, inizialmente `INSERTED`), `createAttempt` genera il successivo identificativo deterministico (`att_003_2` nel dataset iniziale). L'upsert viene aggiunto in fondo alla lista senza sostituire il tentativo precedente; avvio e prima transizione `PAYING` hanno timestamp `clock()` e base `SOURCE_EVENT`. Il tentativo ha metadati completi, timeline completa e `tokenDisplay` in chiaro per gli utenti autenticati. Il pagamento passa a `PAYING`: una seconda creazione immediata è rifiutata perché non è più `INSERTED`. Eseguire lo scenario prima che la fixture scada per retention.
* **Completamento dimensioni**: su `att_008_1` (`00000000002/300000000000000008`), `completeDimensions` riempie i soli `psp`/`stazione`/`canale` null. Non cambia dimensioni presenti, stato o timeline; ripetendolo non cambiano revisione né eventi. Non accetta valori dimensionali nel body: solo `action` e `attemptId`.
* **Riconciliazione temporale**: su `att_007_1` e `att_008_1` (`00000000002`, NAV rispettivamente `300000000000000007` e `300000000000000008`), `correctTimestamps` sostituisce solo avvio/transizioni con base `INFERRED` o `ANOMALY`. Definisce `source = firstSeenAt originario - 60000 ms`, indipendente dall'orologio al momento del controllo; avvio corretto = `source`, transizione corretta di indice `i` = `source + i * 60000 ms`, tutti UTC e `SOURCE_EVENT`. Date già `SOURCE_EVENT` restano invariate. Corregge anche la prima transizione logica delle fixture 7/8, inizialmente rispettivamente `INFERRED`/`ANOMALY`, a `source`. Lo stato corrente resta invariato, senza aggiungere o riapplicare transizioni. Azzera `timelineIncomplete` del tentativo; quello del pagamento è ricalcolato e diventa `false` quando nessun tentativo rimasto è incompleto. Ripetere è un no-op senza revisione né delta. `firstSeenAt` resta un metadato tecnico non esposto.
* **Ripristino**: con stream già aperto, `empty: true` elimina il dettaglio locale; il successivo `empty: false` lo ricostruisce interamente dai delta: timeline logica completa sulla lista ormai vuota, flag esplicito e tutti gli upsert. Non occorre una GET se le revisioni sono contigue. Una nuova sottoscrizione durante la cancellazione resta soggetta a `404`.

## Stream SSE

`GET /api/events` restituisce `text/event-stream`. `EventSource` nativo non supporta l'header `Authorization`: il client usa `fetch` con lettura in streaming.

```bash
curl -N -H "Authorization: Bearer DEMO_OPERATOR" \
  "$BASE/api/events?scope=payment&paFiscalCode=00000000001&noticeNumber=300000000000000001"
curl -N -H "Authorization: Bearer DEMO_OPERATOR" "$BASE/api/events?scope=overview"
curl -N -H "Authorization: Bearer DEMO_OPERATOR" "$BASE/api/events?scope=creditor&paFiscalCode=00000000001"
curl -N -H "Authorization: Bearer DEMO_OPERATOR" \
  "$BASE/api/events?scope=station&paFiscalCode=00000000001&stazione=00000000001_01"
# Stream scoped a una pagina visibile (chiavi separate da virgola)
curl -N -H "$H_OP" \
  "$BASE/api/events?scope=payment-list&keys=00000000001:300000000000000001,00000000001:300000000000000002"
curl -N -H "$H_OP" \
  "$BASE/api/events?scope=creditor-list&keys=00000000001,00000000002"
# riconnessione
curl -N -H "Authorization: Bearer DEMO_OPERATOR" -H "Last-Event-ID: <id>" "$BASE/api/events?scope=overview"
```

Parametri per `scope`:

* `payment`: solo `paFiscalCode` + `noticeNumber` (altre chiavi → `400`).
* `payment-list`: `keys` è una lista comma-separated di 1–100 chiavi `paFiscalCode:noticeNumber` (PA 11 cifre, NAV 18 cifre); non ammette altri filtri. Chiavi duplicate/malformate, liste oltre 100 e chiavi inesistenti o non autorizzate sono rifiutate (`400` per input non valido, `404` uniforme per chiavi non disponibili) nelle nuove sottoscrizioni. Una riconnessione con `Last-Event-ID` valido e legato all'elenco può riprodurre l'invalidazione di chiavi eliminate dopo lo snapshot; un cursore scaduto restituisce `410` prima del controllo d'esistenza. Una sola connessione copre la pagina visibile; le chiavi sono ordinate prima del binding dello scope.
* `creditor-list`: `keys` è una lista comma-separated di 1–100 codici fiscali PA distinti; non ammette altri filtri e applica la stessa autorizzazione fail-closed e semantica di replay di `payment-list`.
* `overview`: nessun parametro obbligatorio; ammette gli stessi filtri REST (`paFiscalCode`, `noticeNumber`, `logicalState`, `attemptState`, `serviceIdentifier`, `psp`, `canale`, `stazione`, `anomaliesOnly`, `unresolvedOnly`) e `from`/`to`. `stazione` richiede `paFiscalCode`.
* `overview` (anche snapshot REST `/api/overview`): include `primitives`, righe `{ serviceIdentifier, primitive, requests, responses, warnings }` (una per servizio e primitiva) con le richieste di primitiva nella finestra; `warnings` conta le richieste senza risposta entro 10 s. `aggregate.delta` porta le differenze in `changes.primitives`. Con `live=true` (solo `overview`, REST e SSE) la finestra delle primitive resta aperta a destra: le richieste dopo `to` si contano comunque, nello snapshot e nei delta. Dati sintetici derivati dai passaggi di stato (nessuna lettura RE); `GET /api/overview/primitive-warnings?primitive=…` (stessi `from`/`to`/`live` e filtri dell'overview, `serviceIdentifier=~unknown` per il servizio non disponibile, `pageSize`/`cursor`) elenca le chiamate contate in `warnings`, dalla più recente, come `{ calledAt, psp, canale, paFiscalCode, stazione }`; `primitive` è obbligatoria (400 se assente); gli snapshot `creditor` e `station` non espongono il campo (i loro delta lo riportano comunque, ignorato dal client).
* `creditor`: `paFiscalCode` obbligatorio (`stazione` non ammesso); `station`: `paFiscalCode` + `stazione` obbligatori; entrambi con gli altri filtri e `from`/`to` opzionali.
* Più di una dimensione (`serviceIdentifier`, `psp`, `canale`, `stazione`) o `stazione` senza ente sugli scope aggregati → `422 UNSUPPORTED_AGGREGATION`. Parametri non validi o combinazioni di scope errate → `400`; ente non visibile o pagamento assente/eliminato → `404`.

 Ogni frame è `id: <cursore opaco di 32 caratteri>`, `event: <tipo>`, `data: <JSON>`; `data.scope` riporta l'oggetto query normalizzato (chiavi ordinate, `from`/`to` solo se forniti), es. `{ "paFiscalCode": "...", "scope": "creditor" }`.

Eventi (schemi `ReadyEvent`, `PaymentDelta`, `AggregateDelta`, `ListChangedEvent`):

* `ready`: `{ type, scope, projectionRevision, window? }`. La revisione è quella del pagamento (scope `payment`) o della proiezione REST (altri scope). Per gli scope aggregati `window` `{ from, to }` è la finestra **fissata all'apertura dello stream** (default ultima ora); per `payment` e gli scope list è assente. Gli scope list usano la revisione aggregata e il client la confronta con `snapshotRevision` della pagina REST per rilevare le modifiche avvenute tra snapshot e sottoscrizione. Dopo un replay arriva **dopo** gli eventi riprodotti.
* `payment.delta` (solo scope `payment`): `{ type, scope, paFiscalCode, noticeNumber, projectionRevision, changes }` con `changes = { logicalTransitions, logicalTransitionCorrections?, attemptChanges: [{ attemptId, transitions, warning, upsert?, patch?, transitionCorrections? }], removedAttemptIds, deleted, timelineIncomplete? }`. `logicalTransitions` e `transitions` restano append; `attemptId`, `transitions` e `warning` restano obbligatori in ogni entry. Le estensioni opzionali sono descritte sotto.
* `aggregate.delta` (scope `overview`, `creditor`, `station`, filtrati per ente/stazione): `{ type, scope, projectionRevision, changes, freshness }`. In `changes` ogni numero è una **differenza con segno** (dopo meno prima): `counts` (`payments`, `attempts`, `unresolvedPayments`, `unresolvedAttempts`, `anomalyTransitions`), `logicalStates` e `attemptStates` (`state`, `count`), `traffic` (`bucketStart`, `startedAttempts`, `estimatedStarts`), `transitions` (`bucketStart`, `entity`, `state`, `timestampBasis`, `count`), `matrices.psp`/`matrices.canale` (`value`, `state`, `count`; `value` null = non disponibile), `anomalies` (`transitions`, `payments`) e `durations` (`entity`, `fromState`, `toState`, `timestampBasis`, `samples`, `totalMs`: somme additive con segno, mantenute per compatibilità). I quantili non sono additivi: `durationSnapshot` sostituisce l'intero insieme delle righe di durata per scope, filtri e finestra; `[]` azzera i risultati. Le righe REST contengono `averageMs`, `medianMs` e `p95Ms` calcolati sui campioni reali con nearest-rank (`ceil(p*n)-1`), separatamente per `SOURCE_EVENT` e `INFERRED`; tempi negativi e transizioni `ANOMALY` sono esclusi. Compaiono solo righe additive con variazione non nulla; il delta può essere vuoto (es. `freshness`). Il delta usa gli stessi filtri e la stessa finestra fissa `[from, to)` dello stream (`ready.window`), **non** una finestra mobile di 60 giorni. Tutti gli schemi evento sono strict (`additionalProperties: false`).
* `list.changed` (scope `payment-list`, `creditor-list`): `{ type, scope, projectionRevision }`. È solo un'invalidazione della pagina e non include righe, payload o token. È emesso solo se cambia una chiave inclusa nello scope. La UI segnala l'aggiornamento disponibile e rilegge la pagina solo dopo l'azione esplicita dell'operatore; non fa polling né apre stream per singola riga. I duplicati mantengono lo stesso ID e sono deduplicati dal client.
* Id evento: per gli eventi aggregati sono opachi e stabili tra i replay (stesso evento logico per utente/filtri/finestra), quindi deduplicabili.
* Heartbeat: commento `: heartbeat` ogni 15 s, da ignorare.

Sequenza consigliata per il client:

1. Per `overview`, `creditor` e `station`, apre lo stream **prima** dello snapshot (meglio con `from`/`to` espliciti) e accoda gli eventi; `ready` indica la revisione iniziale e la finestra. Per `payment-list` e `creditor-list`, legge prima la pagina REST e poi apre un solo stream sulle chiavi restituite.
2. Negli scope list confronta `ready.projectionRevision` con `snapshotRevision` della pagina per rilevare cambi tra lettura e sottoscrizione. Negli scope aggregati legge lo snapshot REST con gli **stessi filtri** e `ready.window` come `from`/`to`; in tutti gli scope applica solo gli eventi con revisione maggiore e deduplica per `id` (vedi `duplicate`).
3. Un salto di revisione del pagamento (`gap`) richiede un singolo riallineamento mirato: rilettura della coppia PA/NAV.
4. Alla riconnessione invia `Last-Event-ID` (legato a utente e scope). Se non riproducibile (storico di 100 eventi / 5 minuti, `expireReplay`, o qualunque pulizia per retention: la cache di replay viene svuotata e il `410` è verificato prima dell'esistenza del pagamento) la risposta è `410 SSE_CURSOR_EXPIRED` con `resync: true`: aprire un nuovo stream e rileggere lo snapshot. Questo è il confine esplicito di resync; non esiste un evento SSE `resync`. Una nuova sottoscrizione a un pagamento eliminato dà `404` (come la lettura ordinaria); l'evento di cancellazione su uno stream già aperto viene comunque consegnato.

### Applicazione di `payment.delta`

Il contratto usa i nomi esistenti `Attempt` (oggetto REST restituito da `safeAttempt`), `AttemptTimelineItem` e `LogicalTimelineItem`; questi ultimi sono rispettivamente le transizioni di tentativo e pagamento logico.

1. Scartare eventi con revisione uguale o inferiore a quella locale, anche se l'id SSE è diverso. Applicare solo la revisione successiva; se manca una revisione, riallineare la coppia senza tentare un'applicazione parziale. Un delta contiguo non richiede una GET, neppure se contiene un nuovo tentativo, una correzione o il ripristino `empty: false`.
2. Applicare prima `removedAttemptIds`, rimuovendo interi tentativi, poi upsert, patch e correzioni in posizione. Infine appendere `logicalTransitions` e le `transitions` dei tentativi. Con `deleted: true` eliminare il dettaglio locale, incluse entrambe le timeline, conservando il riferimento all'ultima revisione per deduplicare e consentire il ripristino contiguo.
3. Per ogni entry con `upsert`, usare l'intero `Attempt` sicuro: se l'id è sconosciuto aggiungerlo in fondo alla lista; se noto sostituire integralmente l'oggetto **nella stessa posizione**, senza merge. `upsert.attemptId` deve coincidere con l'entry e la coppia PA/NAV con il delta. La timeline è già completa: `transitions` deve essere `[]`, mentre `patch` e `transitionCorrections` devono essere **assenti**, anche se vuoti. Nessun `paymentToken`, `firstSeenAt` o `expiresAt`; `tokenDisplay` è sempre `••••••••`.
4. Senza upsert il tentativo deve essere noto. `patch` è un oggetto strict non vuoto, con soli `serviceIdentifier`, `psp`, `stazione`, `canale` (stringa o null), `attemptStartedAt` (UTC al millisecondo o null), `startTimestampBasis` (`SOURCE_EVENT`, `INFERRED`, `ANOMALY`), `timelineIncomplete` (booleano). `attemptStartedAt` e `startTimestampBasis` devono comparire insieme. Proprietà omesse = invariate; null = dato esplicitamente non disponibile. Patch e correzioni possono coesistere prima degli append.
5. Ogni `transitionCorrections` è un array di oggetti strict `{ index, transition }`, con `transition` di schema `AttemptTimelineItem`; `changes.logicalTransitionCorrections` è analogo con `LogicalTimelineItem`. L'indice è un intero >= 0 riferito a un elemento **già esistente prima degli append**. Si sostituisce l'elemento intero, conservando il suo `state`; cambia la provenienza temporale e/o il timestamp, non la progressione FSM. Nessun indice duplicato nella stessa timeline, anche con payload diversi, e una sola entry per `attemptId`; nessun id ripetuto nelle rimozioni. Gli indici sono fissi per l'intera vita dell'entità: vietati inserimenti, riordini e rimozioni di singoli elementi, anche con upsert. È ammessa la rimozione dell'intero tentativo per retention; non ordinare mai per timestamp, che può cambiare.
6. Applicare `timelineIncomplete` del pagamento solo se presente; per il tentativo usare il flag dell'upsert o della patch. Il flag omesso resta invariato: **non dedurlo mai dall'assenza di anomalie**. Una timeline può essere incompleta pur non avendo transizioni `ANOMALY`.
7. Dopo l'applicazione derivare `state`, `warning`, `hasAnomaly` di ogni tentativo, e `state`, `warning`, `hasAnomaly`, `attemptCount` del pagamento. Lo stato è l'ultimo elemento della relativa timeline; il warning del tentativo corrisponde a `PAYMENT_UNKNOWN`/`PAYMENT_SEND_ERROR`, quello del pagamento alla presenza di almeno un tentativo in warning. `hasAnomaly` indica almeno una transizione `ANOMALY`, per il pagamento considerando anche i tentativi. `attemptCount` conta tutti i tentativi rimasti. Il `warning` obbligatorio dell'entry è compatibile con il risultato derivato.
8. Impostare `projectionRevision` del pagamento e di **tutti** i tentativi rimasti alla revisione dell'evento, anche per tentativi non citati o invariati. Non lasciare revisioni precedenti su oggetti mantenuti in memoria.

Esempio di correzione senza regressione (frammento di `changes.attemptChanges`, tentativo già noto con primo stato `PAYING`):

```json
{
  "attemptId": "att_008_1",
  "transitions": [],
  "warning": false,
  "patch": {
    "attemptStartedAt": "2026-01-15T11:59:00.000Z",
    "startTimestampBasis": "SOURCE_EVENT",
    "timelineIncomplete": false
  },
  "transitionCorrections": [{
    "index": 0,
    "transition": {
      "state": "PAYING",
      "transitionAt": "2026-01-15T11:59:00.000Z",
      "timestampBasis": "SOURCE_EVENT"
    }
  }]
}
```

Le correzioni della prima transizione logica viaggiano separatamente in `changes.logicalTransitionCorrections`; il flag logico aggiornato in `changes.timelineIncomplete`. Le timeline delle due entità non vanno fuse.

I delta non contengono il pagamento completo né il campo `paymentToken`; gli upsert contengono l'intero tentativo REST, incluso `tokenDisplay` in chiaro per gli utenti autenticati.

La correzione di `attemptStartedAt` non riavvia né estende la retention: nel mock anticipa la scadenza a `source + 60 giorni` se precedente a quella già stabilita. Se il tentativo risulta già scaduto, segue il delta di rimozione; non occorre una GET per applicarlo.
Ogni pubblicazione riunisce le variazioni di un batch in memoria in un solo delta aggregato per scope: per esempio `empty` aggiorna tutte le coppie senza inviare un pagamento alla volta alla dashboard. Il mock non implementa scheduling distribuito, database o publisher outbox di produzione.

## Cursori e paginazione

* Dimensione pagina `pageSize` default `20`, massimo `100`. `sort`: `key` per pagamenti, tentativi e stazioni; `traffic` (default) o `unresolved` per gli enti.
* Il cursore è un valore opaco casuale di 32 caratteri, memorizzato lato server, con TTL di 5 minuti. Le risposte contengono `items`, `nextCursor`, `snapshotRevision`.
* È legato a utente autenticato, filtri, ordinamento, pageSize e revisione dello snapshot.
* Malformato → `400`. Scaduto o revisione aggregata cambiata (qualsiasi pubblicazione) → `410 CURSOR_EXPIRED`: ripetere la query senza cursore.
* Anche i cursori SSE (`Last-Event-ID`) sono opachi e legati a scope e utente.

## Filtri e aggregazioni

* Un filtro assente significa nessun filtro. Il valore `~unknown` seleziona i tentativi con dimensione non disponibile (null: `psp`, `canale`, `stazione`, `serviceIdentifier`).
* I filtri di dimensione e stato tentativo devono corrispondere allo stesso tentativo. Le liste di pagamenti selezionano le coppie con almeno un tentativo corrispondente, mostrando il riepilogo completo della coppia; gli aggregati contano solo i tentativi corrispondenti e ogni coppia una sola volta. `anomaliesOnly=true` seleziona le coppie con almeno una transizione anomala (anche nei tentativi); `unresolvedOnly=true` seleziona i tentativi attualmente in warning.
* Famiglie aggregate supportate: matrici stato × `psp` e stato × `canale`, ente × stato, ente × stazione × intervallo. Più filtri dimensionali insieme, o `stazione` senza `paFiscalCode`, su overview/enti/stazioni → `422 UNSUPPORTED_AGGREGATION`; usare la lista `/api/attempts` con gli stessi filtri.
* Finestra `[from, to)` UTC al millisecondo (`2026-01-01T00:00:00.000Z`), default ultima ora, massimo 60 giorni, `from < to` (altrimenti `400`). L'applicazione offre preset condivisi 1 ora, 24 ore, 7 giorni e 60 giorni, con selezione predefinita dell'ora. Applicabile a overview, enti, stazioni e, con `from`/`to`/`live` opzionali, agli elenchi `/api/payments` e `/api/attempts`. Tutti i conteggi (stati, non risolti, matrici, anomalie, traffico) riguardano le sole entità con attività nella finestra: almeno una transizione datata (o l'avvio del tentativo) in `[from, to)`, mostrando lo stato corrente; `live=true` lascia il bordo destro aperto. Le entità senza alcuna data non rientrano in nessuna finestra. Finestre senza traffico mostrano zero/nessun dato: non si sostituiscono fixture.
* Traffico: tentativi con `attemptStartedAt` nella finestra (assenti esclusi). Trend: transizioni nella finestra. Durate: transizioni terminali nella finestra. Le transizioni `ANOMALY` (senza data) sono contate negli indicatori di anomalia ma escluse da trend e durate; `INFERRED` resta distinto da `SOURCE_EVENT`.

## Errori

Gli errori sono JSON `{ "code", "message" }` (schemi `Error400`...`Error500`): `400 INVALID_REQUEST` richiesta/cursore non validi, `401` bearer assente o sconosciuto, `403` ruolo o ente non consentito, `404` risorsa assente o scaduta per retention, `410` cursore scaduto (`CURSOR_EXPIRED`, `SSE_CURSOR_EXPIRED` con `resync: true`), `422 UNSUPPORTED_AGGREGATION` con `fallback: "/api/attempts"`, `500` (`MOCK_FAILURE`, `AUDIT_UNAVAILABLE`, `INTERNAL_ERROR`) dichiarato su ogni operazione. `403` anche per richieste con `Origin` diverso da `http://${Host}`; `422` anche su `/api/events` per gli scope aggregati. Le `401` hanno `WWW-Authenticate: Bearer realm="local-demo"`.

## Differenze rispetto alla produzione

* Il mock esegue scansioni complete in memoria. In produzione le ricerche devono usare indici (`(paFiscalCode, noticeNumber)`, `paymentToken`, stato, `serviceIdentifier`, `psp`, `canale`, `stazione`) e paginazione keyset; nessuna richiesta utente deve eseguire scansioni complete.
* I conteggi dashboard devono provenire da un read model aggregato aggiornato incrementalmente (dedup per `outboxId`, delta coalesciati), non dall'aggregazione della proiezione.
* La retention di 60 giorni è implementata in memoria nel mock (`advanceClock`); in produzione è una pulizia del database, non simulata qui. Autenticazione reale, audit persistente e canale SSE condiviso tra istanze non sono simulati.

## Indicazioni per il backend reale: allineamento FSM/RE

Riferimenti normativi: `docs/spec/FSM stati di pagamento.md` e `docs/spec/Specifiche piattaforma osservabilita pagamenti.md`. Il catalogo mock è un insieme di esempi verificabili, **non** un consumer RE né una fonte autorevole per inferire stati. Le seguenti attività riguardano il servizio backend reale, non implementato in questo progetto.

### 1. Ammissione, chiavi e validazione

* Ammettere solo `esito = CAMBIO_STATO` con prefisso `payment_`, `position_` o `receipt_recipient_`, separando le tre entità. Non leggere payload né correlare eventi `INTERFACCIA`, stati RPT o carrello.
* Selezionare l'entità dal prefisso e rimuovere **solo quel prefisso**. `payment_PAYMENT_UNKNOWN` produce `PAYMENT_UNKNOWN`, non `UNKNOWN`.
* Correlare la posizione con `(idDominio, noticeNumber)` e il tentativo anche con `paymentToken`. Un evento `position_*` non identifica il tentativo.
* Validare il suffisso contro l'enum dell'entità: 5 stati logici, 18 del tentativo. Stato sconosciuto o chiavi mancanti non aggiornano proiezione, conteggi o delta: produrre una diagnosi tecnica senza token in chiaro/payload e prevedere riconciliazione.
* Non aggiungere `position_CANCELLED` né convertire automaticamente le grafie abbreviate `payment_SENT`, `payment_ACCEPTED`, `payment_REFUSED`, `payment_SEND_ERROR`, `payment_UNKNOWN`: servono campioni reali e conferma della versione Nodo.

### 2. Risoluzione separata delle FSM

* Implementare le tabelle di transizione per entità e percorso/versione documentati, non un ranking globale degli stati. Distinguere outcome KO NM3, KO PSP, errore invio e annullo.
* Coprire il ramo NM3 diretto `PAYING → PAID/FAILED`, il ramo close/PSP, `PAYMENT_UNKNOWN → PAID/CANCELLED`, gli annulli close V2 e il ramo ricevuta `PAID → NOTICE_GENERATED → NOTICE_SENT → NOTIFIED`.
* Gestire gli stati legacy senza eliminarli o attribuire automaticamente `PAYING_RPT` all'attivazione. Non inventare gli archi di ingresso ancora da verificare; accettare/inferire solo i percorsi supportati dalle evidenze.
* **Non copiare il mutatore del mock:** una singola azione demo aggiorna insieme posizione e tentativo per simulare un flusso. Nel consumer reale `payment_*` aggiorna esclusivamente il tentativo e `position_*` esclusivamente la posizione. Non derivare lo stato logico dall'outcome di un token né attendere eventi dei destinatari esclusi per applicare `payment_NOTIFIED`.
* `position_NOTIFIED` e `payment_NOTIFIED` hanno condizioni diverse. Il consumer riceve l'attestazione del Nodo: non ricostruisce gruppi/destinatari con identificativi fuori perimetro e non deduce esito applicativo OK da `NOTIFIED`.
* L'annullo per scadenza è deciso dal Nodo. Il backend di osservabilità non lo anticipa con timer locali; il cleanup di retention è un'operazione distinta.

### 3. Provenienza del trigger e timestamp

* Leggere `tipoEvento` solo dall'evento di cambio stato ammesso e usarlo come `trigger` opzionale della timeline di quella entità. Mantenere la provenienza ricevuta, comprese le versioni, senza rinominare `sendPaymentOutcomeV2` in `paSendRTV2` su `NOTIFIED`.
* Il solo stato finale non identifica causa, versione o dettaglio OK/KO/timeout. `esito = CAMBIO_STATO` è il tipo di evento RE, non l'esito applicativo del pagamento. Se la provenienza è assente, restituire `trigger: null` o omettere il campo, senza default basati sullo stato.
* Restituire il medesimo `trigger` negli snapshot REST, negli append SSE, negli upsert e nelle correzioni temporali. `LogicalTimelineItem` e `AttemptTimelineItem` dell'OpenAPI lo ammettono entrambi, senza renderlo obbligatorio.
* Convertire `dataOraEvento` da `Europe/Rome` a UTC secondo la spec, comprese le ore ambigue/inesistenti. Data mancante o non interpretabile: `transitionAt: null`, base `ANOMALY`, senza ripiego sull'ora di elaborazione. Per l'inferenza conservare la provenienza dell'evento che la consente, marcando la transizione come inferita.

### 4. Duplicati, concorrenza e inferenza

* Deduplicare con `uniqueId`, con fallback tecnico di trasporto previsto dalla spec; serializzare gli aggiornamenti per PA/NAV tramite lock o compare-and-set.
* Non riaprire un tentativo annullato con eventi tardivi; consentire nuovi token per una posizione riaperta. Un evento ricevuto fuori ordine non determina automaticamente una regressione.
* Inferire solo predecessori univoci: `PAID` non implica `PAYMENT_ACCEPTED` e `PAYMENT_RESERVED` non implica sempre un precedente `PAYING` dello stesso token (V1 PA OLD). Segnalare timeline incompleta quando le evidenze non bastano.
* Retry tecnici/no-op non riapplicano transizioni né incrementano revisioni. Nuove evidenze temporali attendibili possono invece correggere una transizione senza riapplicarla, senza estendere i 60 giorni di retention.

### 5. Persistenza, contratto e pubblicazione

* In un'unica transazione salvare deduplica, modifiche della proiezione, revisione locale e outbox; confermare il checkpoint Event Hubs solo dopo il commit. Nessun outbox di business se la proiezione non cambia.
* Mantenere `projectionRevision` per coppia PA/NAV e delta coerenti con il REST: append per vere transizioni, correzioni per indice per riconciliazioni, upsert completi per nuovi tentativi. Il FE non deve fare una GET per ogni evento.
* Aggiornare incrementalmente i conteggi e deduplicare l'outbox; preservare warning finché `PAYMENT_UNKNOWN`/`PAYMENT_SEND_ERROR` non sono risolti. SSE per pagamento/scopi aggregati con replay, autorizzazione e cursore; un salto di revisione richiede il singolo riallineamento previsto.
* Non esporre `/__mock/control` o credenziali demo in produzione. Il nuovo controllo `scenario` non è un requisito dell'API di business.

### 6. Verifiche richieste prima del rilascio

Usare come casi di accettazione i percorsi interattivi sopra e i test in `mocks/test/scenarios.test.mjs`, aggiungendo le verifiche proprie del consumer: eventi `payment_*`/`position_*` indipendenti, duplicati/fuori ordine, gruppi NMU gestiti dalla sorgente, chiavi mancanti, stati sconosciuti, timestamp invalidi e cambi CET/CEST, atomicità DB/outbox e crash prima/dopo checkpoint.

Restano bloccanti per estendere il mapping: evidenza su `position_CANCELLED` e sulle grafie abbreviate, campioni degli stati intermedi/legacy, ingressi non documentati in `PAYING_RPT`/`CANCELLED_NORPT`. Restano aperti i drift semantici già tracciati nella FSM (`PAYMENT_SEND_ERROR` e interpretazione di `NOTIFIED`); il mock conserva le categorie attuali e non li risolve implicitamente.
