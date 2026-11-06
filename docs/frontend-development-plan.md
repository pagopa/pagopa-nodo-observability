# Piano di sviluppo frontend e integrazione backend

Stato: implementazione frontend Angular e mock locale completati per la demo; integrazione backend reale fuori perimetro.

Aggiornamento 23 ottobre: la chiarezza degli stati è definita nel
[design approvato](superpowers/specs/2026-10-23-payment-state-clarity-design.md).
Catalogo semantico per entità e fasi, storia osservata separata dai percorsi
documentati e destinatari REST/SSE sostituiscono lo stepper basato sull'enum.
Accettazione PSP non è pagamento acquisito; archiviazione non è consegna;
`NOTIFIED` non certifica esito applicativo PA OK. L'invio da tentativo
`NOTICE_STORED` rimane documentato con applicabilità da confermare, non un
nuovo arco generale della FSM. I mockup includono scenari di accettazione
senza modificare l'accesso in sola lettura o introdurre KPI client.
Data: 16 ottobre 2026.

## Obiettivo e consegna corrente

La consegna è una console operativa in sola lettura per consultare pagamenti
logici, tentativi, anomalie temporali e freschezza dell'acquisizione. Lo sviluppo
parte dal contratto HTTP, con un backend mock autonomo REST/SSE.
Il frontend deve poter passare al backend reale cambiando configurazione e
autenticazione, senza riscrivere le feature.

L'applicazione standalone è integrata con il mock REST/SSE e include tutte e cinque
le viste richieste. Le fixture non rappresentano dati reali e non dimostrano prestazioni su milioni
di record, affidabilita' dell'outbox o correttezza del consumer Event Hubs.

Artefatti disponibili:

* [Contratto OpenAPI 3.1](api/openapi.json) per REST, sicurezza, errori e schemi dei delta SSE.
* [Guida del mock](api/mock-usage.md) con avvio, credenziali demo, curl, cursori e scenari.
* `mocks/server.mjs` e `mocks/model.mjs`: server locale e fixture sintetiche.

Avviare il mock e l'applicazione in due terminali: `npm run mock` avvia il
backend su `http://127.0.0.1:3001`; `npm start` avvia Angular su
`http://localhost:4200` e inoltra `/api` al mock. Il workaround del runtime
locale e' documentato nella guida. Nessuna credenziale demo deve essere
utilizzata nel backend reale.

## Riferimenti e precedenza

* [Specifica funzionale](spec/Specifiche%20piattaforma%20osservabilita%20pagamenti.md), in particolare sezioni 1-3, 4.2-4.4, 5 e 8.
* [FSM del Nodo](spec/FSM%20stati%20di%20pagamento.md): significato degli stati e dei percorsi, non ampliamento del perimetro dati.
* [Dashboard](mockups/index.html), [catalogo mockup](mockups/panoramica.html), [Pagamenti](mockups/02-pagamenti.html), [Dettaglio pagamento](mockups/03-dettaglio-pagamento.html), [Enti creditori](mockups/04-enti-creditori.html), [Dettaglio ente](mockups/05-dettaglio-ente.html).
* [Linee guida Angular](../AGENTS.md) e analisi delle primitive in `docs/analysis/`.

La specifica funzionale determina perimetro e semantica; i mockup determinano
layout e gerarchia visiva. Le divergenze elencate sotto sono state valutate e
le decisioni per la demo sono approvate; specifiche e mockup originali restano
invariati.

## Vincoli di dominio non negoziabili

* Pagamento logico identificato da `(paFiscalCode, noticeNumber)`, tentativo da `paymentToken`; timeline e FSM separate.
* Cinque stati logici, diciotto stati tentativo e quattro stati destinatario, inclusi legacy, con valori originali. Destinatari per posizione senza associazioni al token o completezza dedotte. Nessun payload ricevuta, importo, `transactionId` o `sessionId`.
* Lo stato logico viene dalla timeline della posizione, non dalla sintesi degli esiti dei tentativi. Una cancellazione riguarda quel tentativo e non elimina gli altri.
* `PAYMENT_UNKNOWN` e `PAYMENT_SEND_ERROR` producono un warning visivo finche' il singolo tentativo non cambia stato. Non sono notifiche esterne o diagnosi definitive.
* `NOTIFIED` non prova da solo un esito applicativo positivo. Non aggiungere dettagli delle ricevute per spiegarlo.
* La sequenza accettata viene restituita dal backend; il browser non riordina per timestamp e non ricostruisce transizioni ambigue.
* Date UTC al millisecondo; provenienza `SOURCE_EVENT`, `INFERRED`, `ANOMALY`. La transizione anomala resta visibile senza data; nessun ripiego sull'ora del browser.
* Retention di 60 giorni indipendente per tentativo. Alla scadenza scompare solo quel tentativo; il pagamento scompare con l'ultimo. Se l'avvio manca, il backend usa il riferimento tecnico previsto dalla specifica, non una data funzionale inventata.
* Token accessibile solo con autorizzazione server-side, mai in URL, cursori, telemetria, log tecnici o storage browser. La UI usa un identificatore tecnico opaco per selezione, tracking e aggiornamenti dei tentativi.

## Esito della revisione dei mockup

| Area | Evidenza | Azione prevista |
| --- | --- | --- |
| Navigazione | Logo e voce Dashboard aprono `index.html`, che contiene la dashboard; `panoramica.html` e' il catalogo dei mockup. | Route `/overview` dedicata alla dashboard; il catalogo HTML non e' una schermata del prodotto. |
| Ricerca | Modalita' tentativo continua a mostrare righe di pagamento; ricerca token e molti filtri sono dimostrativi. | Modelli di pagina distinti per pagamenti e tentativi, validazione e ricerca server-side. |
| Collegamenti | Il dettaglio sceglie due scenari invece della coppia ricevuta; filtri e chip perdono contesto. | PA/NAV reali nelle route; query params preservati nei drill-down e nel ritorno alla lista. |
| Risultato vuoto | Alcune ricerche senza corrispondenze mostrano fixture alternative. | Zero risultati esplicito, mai sostituzione silenziosa con dati estranei. |
| Paginazione | Pulsanti simulati con toast. | Cursori opachi, pagina successiva e stack dei cursori precedenti; nessun totale sincrono. |
| Grafici | Conteggi moltiplicati artificialmente, segmenti irrisolti ingranditi e barre non proporzionali. | Valori coerenti con le API; scala dichiarata e proporzioni reali; nessun fattore dimostrativo. |
| Finestre | Dashboard 24h/7g/60g, dettaglio ente anche 14g; conteggi correnti e traffico sono mescolati. | Finestre condivise 1h/24h/7g/60g, default 1h; tutti i conteggi (stati, KPI, non risolti, traffico) seguono la finestra selezionata; le liste aperte dalla dashboard ereditano la stessa finestra. |
| Durate | Il mockup mostra mediana e p95; il contratto iniziale esponeva media e numero di campioni. | REST espone media, mediana e p95 nearest-rank dai campioni reali. I delta mantengono `durations` additive compatibili e aggiungono la sostituzione completa `durationSnapshot`; mai sommare quantili. |
| Aggregazioni | PSP e canale insieme nascondono i conteggi; altri incroci non sono definiti. | Risposta esplicita per combinazioni non supportate e passaggio alla lista tentativi, senza conteggi inventati. |
| Stati | Filtri e stepper mostrano sottoinsiemi diversi; matrice abbrevia `PAYMENT_*`. | Catalogo tipizzato unico, valori completi accessibili e timeline legacy senza perdita di stati. |
| Sicurezza | Ruolo modificabile nel browser, token inclusi nel sorgente, audit simulato da toast. | Mock solo locale; credenziali dimostrative separate. Backend reale responsabile di autorizzazione e audit effettivo. |
| Realtime | Timer e revisioni simulate, nessuna connessione SSE. | Stream scoped, replay, deduplica, gap e risincronizzazione implementati nel servizio core. |
| Accessibilita' | Righe cliccabili solo col mouse, tooltip e grafici senza alternative sufficienti. | Link reali, focus, intestazioni tabella, descrizioni testuali dei grafici e annunci controllati. |

### Design system: decisione approvata

Angular Material e' la base dei componenti; `@pagopa/mui-italia` e' React e
non deve essere installata nel frontend. Replicare i token approvati in
`src/styles/_tokens.scss` e CSS custom properties.

Il mockup non e' una riproduzione esatta del tema mui-italia. Confronto delle
fonti pubbliche consultate il 16 ottobre 2026:

* Mockup: primario `#0073E6`, testo `#17324D`, body 16px, controlli normalmente 40px.
* `mui-italia/src/theme/colors.ts`: scala `blueitalia` con 500 `#0066CC`; non assumere che questa scala coincida automaticamente con `palette.primary`.
* `mui-italia/src/theme/theme.ts`: body1 18px, body2 16px; pulsanti small 40px, medium 48px; focus e tipografia specifici.
* Font principale Titillium Web condiviso; il tema definisce DM Mono per il monospazio. Evitare l'import Google Fonts dei mockup e distribuire i font approvati localmente.

Fonti fissate alla revisione
[`59c4ba5ca0c7831f761b3475c8a624f9933b5b2f`](https://github.com/pagopa/mui-italia/tree/59c4ba5ca0c7831f761b3475c8a624f9933b5b2f):
[colors](https://github.com/pagopa/mui-italia/blob/59c4ba5ca0c7831f761b3475c8a624f9933b5b2f/src/theme/colors.ts),
[fonts](https://github.com/pagopa/mui-italia/blob/59c4ba5ca0c7831f761b3475c8a624f9933b5b2f/src/theme/fonts.ts),
[theme](https://github.com/pagopa/mui-italia/blob/59c4ba5ca0c7831f761b3475c8a624f9933b5b2f/src/theme/theme.ts).
Le schermate Angular usano Material e i token centralizzati in
`src/styles/_tokens.scss`, inclusi palette, tipografia e raggi Material; mockup e
mui-italia divergono per palette/densità, differenza approvata per la demo.
I font Titillium Web e DM Mono sono distribuiti localmente via npm; nessun font runtime remoto.

## Architettura frontend

### Stack e bootstrap

Applicazione Angular standalone, TypeScript strict, application builder,
OnPush, Signals e nuovo control flow. Angular Material con tema centralizzato;
nessuna dipendenza React/MUI. Preferire rendering client-side per la console
autenticata: non sono richiesti SEO o SSR.

Bootstrap generato con la CLI Angular 22.2.3 (ultima release stabile verificata)
e Node 26.8.2; TypeScript strict, application builder, Angular Material e
angular-eslint sono fissati nel manifest e nel lockfile root. Il mock resta
disponibile con `npm run mock`; `npm start` avvia l'app e il proxy di sviluppo.

### Moduli logici e responsabilita'

```text
src/app/
  core/
    api/                  servizi REST e SSE autenticati
    auth/                 sessione demo, capability, guard funzionale
    http/                 interceptor di autenticazione/correlation ID
    realtime/             riduttore pagamenti per revisioni e correzioni
    timezone.service.ts   formattazione Europe/Rome e UTC
  models/domain.ts        DTO UI, cataloghi distinti e utility di dominio
  features/
    overview/             panoramica
    payments/             lista pagamenti/tentativi e dettaglio
    creditor-entities/    lista enti e dettaglio ente
src/styles/_tokens.scss
```

Le cinque viste sono lazy-loaded e non importano direttamente le altre.
I servizi API risiedono nel core; i componenti non usano direttamente
HttpClient. Le risposte usano tipi TypeScript distinti dalle proiezioni
visuali; gli schemi wire sono verificati da OpenAPI e dal validator del mock.
Il catalogo centrale mantiene separate le FSM logica e tentativo.

Il selettore di fuso orario dell'operatore comprende almeno `Europe/Rome` e
`UTC`: applicare la scelta a tutte le viste tramite una utility condivisa,
senza modificare i valori UTC dei DTO.

Letture REST con il servizio API e sottoscrizioni legate al lifecycle; stato
locale con `signal`, derivazioni con `computed`. RxJS è usato per route,
stream e combinazioni che lo richiedono, con cleanup esplicito.

### Route e stato condivisibile

| Route frontend implementata | Contenuto |
| --- | --- |
| `/overview` | KPI, distribuzioni, matrici, serie, durate, acquisizione. |
| `/payments` | Lista pagamenti; `view=attempts` seleziona la lista tentativi. |
| `/payments/:paFiscalCode/:noticeNumber` | Timeline logica e tutti i tentativi ancora in retention. |
| `/creditor-entities` | Lista enti con ricerca e ordinamento. |
| `/creditor-entities/:paFiscalCode` | Traffico, stati e stazioni dell'ente. |

Query params per filtri, finestra, ordinamento e dimensione di stato. I nomi
HTTP restano quelli del contratto OpenAPI. Non mettere token di pagamento
nei query params: ricerca mediante body HTTP dedicato e navigazione alla coppia
con `attemptId` tecnico. Stato e filtri della lista si ripristinano tornando
dal dettaglio. Un cambio filtro invalida i cursori precedenti.

### Protocollo realtime nel client

1. Aprire lo stream autorizzato relativo alla vista prima dello snapshot e accodare i messaggi.
2. Leggere lo snapshot e la sua revisione; scartare i delta gia' inclusi.
3. Applicare revisioni successive una sola volta, senza polling e senza GET per ciascun evento.
4. Su salto di revisione, accorpare le richieste concorrenti e riallineare una sola volta la coppia interessata.
5. Su riconnessione, riprendere dal cursore SSE; se scaduto aprire prima una nuova sottoscrizione e accodare gli eventi, poi ricaricare solo coppia o pagina corrente e riconciliare come al caricamento iniziale.
6. Chiudere stream e richieste quando cambiano route, filtri o identita'; svuotare token rivelati alla perdita di autorizzazione.

Tutti gli eventi arrivati durante l'acquisizione iniziale o un riallineamento
restano in coda fino all'installazione atomica dello snapshot e sono poi
riconciliati per revisione. Un `ready` su una riconnessione con replay valido
non avvia un GET aggiuntivo; dopo replay scaduto il client attende l'apertura
dello stream nuovo prima di richiedere lo snapshot. Gli errori di apertura SSE
mantengono lo status HTTP e terminano il caricamento, incluso il fallback
esplicito 422 agli stessi filtri nell'elenco tentativi.

Usare il meccanismo di autenticazione SSE documentato dal mock: EventSource
nativo non accetta header Authorization arbitrari. Mai aggirare il vincolo
inserendo credenziali o token di pagamento nell'URL.

Gli stream delle liste riguardano solo le coppie visibili; quelli aggregati
solo dashboard/ente/stazione selezionati. Gli aggiornamenti non devono
spostare righe in modo inatteso durante la lettura: indicare risultati cambiati
e consentire una rilettura esplicita della pagina quando necessario.
Freschezza dell'acquisizione e stato della connessione browser sono indicatori distinti.
Gli stream vengono sospesi su `pagehide` e ripresi con il cursore su `pageshow`:
anche le pagine conservate nella back-forward cache rilasciano le connessioni
HTTP, senza attendere la distruzione dei componenti Angular.

### Decisioni concrete del contratto iniziale

Le API usano il prefisso `/api`; i controlli `/__mock/*` non fanno parte del
backend reale. La ricerca token usa POST, non query string; il reveal e'
separato dalle letture ordinarie. La decisione del 22 ottobre supera il
mascheramento e le capacità token: token in chiaro per tutti gli utenti della
console, identità demo fissa e nessun IAM in questa fase. Gli eventuali controlli
di ruolo dei vecchi profili del mock sono solo compatibilità dei test storici,
non la policy della UI o del backend corrente.

Pagina default 20 elementi, massimo 100. Cursori opachi con TTL di cinque
minuti, legati a utente, filtri, ordinamento e revisione; una modifica dello
snapshot puo' invalidare la pagina successiva con 410. La UI deve gestire
questo caso senza presentarlo come assenza di risultati.

Le finestre `[from,to)` sono esplicite, massimo 60 giorni e default un'ora;
gli stream aggregati fissano la finestra all'apertura. Usare `ready.window`
anche nella lettura REST iniziale. la UI offre i preset condivisi un'ora, 24 ore, sette giorni e 60 giorni.
Intervalli senza traffico producono valori vuoti/zero senza sintetizzare dati.
Piu' filtri dimensionali insieme negli aggregati producono 422 con fallback
alla lista; nelle liste tali combinazioni restano utilizzabili.

Il dettaglio conserva la timeline accettata dal server e mostra separatamente
la progressione dei cataloghi completi delle due FSM. La progressione usa solo
gli archi documentati dalla specifica FSM, marca come fuori ramo gli stati
senza un percorso documentato e non assegna un rango globale; in particolare
non inventa continuazioni per `NOTICE_STORED` o per altri percorsi legacy
ambigui. Una ricerca per token trasporta solo `attemptId` opaco nella query e
seleziona/focalizza il tentativo corrispondente, mai il token.

La lista enti mostra anche la distribuzione logica per stato e sottoscrive
stream aggregati limitati agli enti visibili nella pagina; gli aggiornamenti
segnalano risultati cambiati senza riordinare righe. L'intervallo `[from,to)`
viene congelato per l'intera pila di cursori e ricalcolato solo quando cambia
la sessione di ricerca. Il dettaglio ente mostra le serie temporali ricevute
per ciascuna stazione e segnala quando la pagina stazioni potrebbe essere
obsoleta.

I delta pagamento supportano append, upsert sicuro di tentativi, patch
dimensionali/temporali, correzioni in posizione delle timeline e rimozioni
per retention. La UI non deve limitarsi ad appendere stati: deve applicare
tutte queste operazioni come descritto nella guida, preservando le due FSM.
Il replay e' limitato a 100 eventi/cinque minuti; il cleanup retention
invalida il replay precedente con 410. Le risorse scadute restituiscono 404:
non esistono tombstone funzionali per distinguere pagamento mai visto e
pagamento interamente eliminato.

## Backlog eseguibile e dipendenze

Le fasi sono ordinate per ridurre il rischio; non sono stime di calendario.
Ogni fase termina con una demo verificabile sul mock.

| Fase | Dipendenze | Lavoro | Criteri di uscita |
| --- | --- | --- | --- |
| P0 - Contratto e mock | Specifica e revisione mockup | Completato: OpenAPI, fixture, REST/SSE, ruoli demo, quantili e scenari riproducibili. | Test mock e validazione OpenAPI superati; mediane/p95 verificati su campioni reali. |
| P1 - Fondazioni Angular | P0 | Completato: bootstrap CLI, Material, token, shell, route lazy, proxy, sessione/capability, interceptor, timezone e test/lint. | Build Angular strict e lint superati. |
| P2 - Ricerca e liste | P1 | Completato: filtri in URL, cursori, liste separate, lookup token POST e contesto nei drill-down. | Zero risultati, errori/cursori scaduti e stream limitati alle coppie visibili gestiti. |
| P3 - Dettaglio e SSE | P2 | Completato: timeline separate, provenance, trigger delle transizioni, warning, reveal/copia auditato, replay/deduplica e revisioni. | Gap riallinea la coppia, duplicati non alterano i dati, token cancellato alla navigazione/sessione. |
| P4 - Panoramica | P1, P3 | Completato: KPI, stati, PSP/canale, trend, durate mediana/p95, anomalie e freschezza. | Delta aggiornano aggregati senza GET ordinari; 422 passa alla lista tentativi. |
| P5 - Enti e stazioni | P2, P4 | Completato: ricerca/ordinamento paginati, dettaglio, trend, stati e drill-down stazioni. | Bucket assente visibile; aggiornamenti non spostano le righe, stazioni ricaricabili esplicitamente. |
| P6 - Consolidamento | P3-P5 | Implementato per l'ambiente demo: accessibilità semantica, responsive, sessione locale, retention, errori e riconnessione SSE. | Test, build, lint e smoke REST/SSE/proxy verificati; non è un audit PA/produzione. |
| P7 - Backend reale | P0-P6; contratti IAM, audit e SLA concordati | Configurazione ambiente, integrazione IAM/audit, test consumer, carico e osservabilita'. | Stessa UI contro API reali, nessuna modifica di dominio; test di conformita' REST/SSE superati e limiti operativi concordati. |

P2-P3 costituiscono il primo incremento verticale prioritario:
ricerca -> dettaglio -> delta -> risoluzione warning. P4 e P5 possono
procedere in parallelo dopo la stabilizzazione dei componenti condivisi.

## Matrice di copertura funzionale

| Requisito specifica | Incremento | Scenario obbligatorio |
| --- | --- | --- |
| 3.1 ricerca/correlazione | P2-P3 | Coppia con più tentativi disponibili in retention; ricerca token e reveal senza capacità IAM nella fase corrente. |
| 3.2 timeline | P3 | Ripetizioni, ramo cancellato e nuovo tentativo pagato; INFERRED; ANOMALY senza data; timeline incompleta. |
| 3.2 realtime e 4.2 outbox | P3 | Stream prima dello snapshot, duplicato, gap, replay, cursore scaduto, ritorno online. |
| 3.3 conteggi e filtri | P4 | Totali logici distinti, diciotto stati tentativo, PSP/canale separati, combinazione non supportata esplicita. |
| 3.3.1 traffico | P5 | Due enti e piu' stazioni, bucket non disponibile, avvio stimato e assente. |
| 1 retention e 4.4 cleanup | P3, P6 | Un tentativo scade e un altro resta; ultimo tentativo scade; dettaglio non piu' disponibile senza inventare lo stato finale. |
| 5 sicurezza | P1-P7 | 401/403, revoca capability, reveal fallito, nessun token nelle risposte base o nello stream. |
| 8 anomalie e freschezza | P4, P6 | Transizione anomala contata, ingestione in ritardo anche con filtri applicati, connessione browser interrotta distinta dal lag. |

## Strategia di qualita'

Unit test per mapping DTO/stati, range e riduttore SSE. TestBed e HTTP simulato
con `provideHttpClientTesting`; verificare DOM per ruolo/testo e non per classi
interne di Material.

Test di integrazione contro il mock per navigazione completa, paginazione,
autorizzazione e SSE; non sostituiscono test di conformita' del backend reale.
Usare fixture e clock deterministici per retention e finestre temporali.
Verificare i due cambi DST nella conversione operata dal backend, non
ricostruire quell'algoritmo nella UI.

Ogni vista deve coprire loading, vuoto, errore e retry esplicito; il dettaglio
copre anche dati scomparsi per retention. Misurare dimensioni delle risposte,
numero di richieste e connessioni aperte: nessun polling, nessun prefetch di
intere liste e nessun flusso globale dei pagamenti nel browser.

Gate root: `npm run lint`, `npm test` (`ng test --watch=false`),
`npm run build`, `npm run test:mock` e `npm run contract:validate`.

Smoke eseguito anche su Chrome headless con rendering reale delle cinque viste:
navigazione, finestra predefinita, reveal e cambio ruolo, risoluzione/delezione/
ripristino via SSE senza GET aggiuntive, singolo riallineamento su gap, quantili,
fallback 422 e pagamento assente. Questo controllo non sostituisce un audit
visuale o di conformita' WCAG dell'intera piattaforma.

## Passaggio al backend reale e decisioni aperte

Il contratto descrive l'API di consultazione, non sostituisce la progettazione
del consumer, degli indici, della deduplica/inbox, della transazione con
outbox, del canale multiistanza o degli aggregati incrementali. Il mock puo'
operare su un piccolo dataset in memoria; il backend reale deve rispettare
i vincoli di scala della specifica senza scansioni sincrone per richiesta.

| Decisione | Responsabili | Quando blocca |
| --- | --- | --- |
| Identita', ruoli, capability token, audit e cifratura | Security e backend | Prima dell'integrazione reale e obbligatoriamente prima dell'esercizio; i ruoli mock non sono policy approvate. |
| Campioni RE intermedi/position, unicita' uniqueId e fallback FSM | Backend e referenti Nodo | Prima di considerare corretta l'acquisizione reale. |
| Percorsi legacy/NMU e semantica timeline incompleta | Dominio e backend | Prima della chiusura P3; nel frattempo preservare tutti gli enum senza inventare archi FSM. |
| Finestre, bucket, limiti pagine, durata cursori e replay SSE | Prodotto, frontend e backend | Contratto iniziale esplicito nel mock, valori da confermare prima di P7. |
| Famiglie di aggregazione e filtri sullo stato logico o tentativo | Prodotto e backend | Prima di chiudere P4; incroci non supportati restano liste paginabili. |
| Conformita' visuale mockup/mui-italia e revisione tema | Design e frontend | Prima del consolidamento visuale di P1. |
| Latenza, fan-out, disponibilita', volumi e retention operativa | Architettura e operations | Prima di definire prestazioni accettabili in P7; nessun valore simulato costituisce uno SLA. |

Le scelte concrete dell'API e le istruzioni di avvio sono nella directory
`docs/api/`; fanno testo per nomi, parametri, errori e messaggi SSE. Eventuali
modifiche incompatibili richiedono aggiornamento coordinato di OpenAPI, mock,
test consumer e servizi Angular.
