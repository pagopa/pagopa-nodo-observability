# Specifiche piattaforma di monitoraggio e osservabilità dei pagamenti

**Stato:** bozza iniziale, basata sul codice di `pagopa-nodo4-nodo-dei-pagamenti/nodo4` e sulle decisioni raccolte.

**Raccordo 23 ottobre 2026:** le vecchie esclusioni dei destinatari e i privilegi
token sono superati dalle decisioni del 22 ottobre descritte sotto. Il dettaglio
mantiene storia osservata e percorsi documentati separati; gli eventuali
riferimenti storici alla sola proiezione posizione/tentativo non restringono
il contratto aggiornato a tre entità.

**Consultazione diagnostica RE — decisione del 23 ottobre 2026:** il recupero
manuale del tentativo da Data Explorer può mostrare tutti gli eventi
corrispondenti a PA + NAV + paymentToken e intervallo, tutti i campi sorgente
e il payload Base64 decodificato come testo in un modale full screen. La
schermata dettaglio mostra inoltre, **in automatico** per ogni tentativo, la
**cronologia delle primitive**: tutti gli eventi RE (richieste e risposte SOAP e
cambi di stato) ordinati nel tempo, con segnalazione delle richieste senza
risposta e dell'ultimo evento ricevuto (decisione del 2 novembre 2026: la
timeline dei soli cambi di stato non basta a capire perché una primitiva attesa,
ad esempio `sendPaymentOutcomeV2`, non arriva). È una consultazione da Data
Explorer senza payload, non una transizione della proiezione e non viene fusa
con la timeline degli stati. La finestra si estende fino all'ora corrente nelle
prime 24 ore del tentativo. Ogni risposta SOAP riporta l'esito letto dal payload
decodificato: KO se contiene `faultCode`, se dichiara `outcome` KO (corpi REST come
gli errori 400/404/422 della closePayment, con la `description` come motivo) o se non
è una busta SOAP/JSON (ad esempio un testo di errore HTTP: «risposta non SOAP»), OK
altrimenti. Il codice HTTP non è tra i dati RE disponibili (la colonna `esito` non
esiste in ADX e `parametriSpecificiInterfaccia`/`info` sono nulli): una risposta non
200 si riconosce solo dal corpo. Le chiamate prive di `paymentToken`, come `verifyPaymentNotice`,
non appartengono a un tentativo: **non sono acquisite nella proiezione** (decisione
del 2 novembre 2026) e si vedono solo nella **consultazione RE della posizione**,
su richiesta, che cerca per PA + NAV senza token (`scope: POSITION`), da 1 ora
prima del primo tentativo e per al massimo 24 ore, e mostra insieme gli eventi di
tutti i token e quelli senza token. Gli eventi con PA e NAV sono sempre presenti
nel Registro Eventi.
È un'eccezione di sola consultazione al precedente divieto UI di payload e
identificativi aggiuntivi, non un'estensione della proiezione, della FSM o degli
SSE. Nessuna persistenza di payload, log del contenuto o scansione senza chiavi.
L'approvazione del token in chiaro non sostituisce la valutazione delle
protezioni sui dati personali nei payload prima del rilascio reale.
La prima consegna era il mockup sintetico; l'integrazione Angular/mock REST
e il backend diagnostico proseguono con accesso reale disabilitato per default.
L'attivazione resta subordinata alle verifiche ADX e protezioni dati approvate; vedere il
[piano FE/backend](../superpowers/plans/2026-10-23-recupero-tentativo-re.md).
I vincoli di esclusione del payload nelle sezioni successive continuano ad
applicarsi all'acquisizione e alle viste della proiezione, non a questa
consultazione diagnostica separata.

## 1. Obiettivo e perimetro

La piattaforma supporta gli operatori nella consultazione dello stato e della storia del pagamento logico, dei tentativi e dei destinatari della ricevuta. La decisione del 22 ottobre 2026 supera l'esclusione iniziale dei destinatari: sono proiettati solo identificativi ammessi, stati e transizioni; ricevute, payload ed esito applicativo PA restano esclusi.

Decisioni di perimetro:

- Il pagamento logico è identificato dalla coppia codice fiscale della PA (`paFiscalCode`) e NAV (`noticeNumber`).
- Per uno stesso pagamento logico possono esistere più tentativi; ogni tentativo è identificato univocamente dal proprio `paymentToken`.
- La vista raggruppa per coppia `(paFiscalCode, noticeNumber)` e mostra tutti i `paymentToken` associati. Per ogni coppia mostra la sequenza degli stati del pagamento; per ogni token mostra la sequenza degli stati del relativo tentativo.
- Il perimetro dei dati di business persistiti comprende codice fiscale, NAV, `paymentToken`, stato del pagamento, stati/tentativi di pagamento, `serviceIdentifier`, `psp`, `stazione` e `canale` di ogni tentativo, data di inizio di ogni tentativo e data-ora di ogni passaggio di stato. Non si persistono payload completi degli eventi né ulteriori identificativi o dati di pagamento.
- Ogni tentativo ha retention indipendente di 60 giorni da `attemptStartedAt`. Alla scadenza vengono eliminati il token, i dati e la timeline del relativo tentativo; il pagamento logico e la sua timeline restano finché esiste almeno un tentativo in retention, poi vengono eliminati. Duplicati ed eventi scartati non reimpostano la data di inizio né prorogano la retention; un timestamp evento attendibile può sostituire una stima, senza estendere la scadenza.
- La prima fase offre dashboard, ricerca e consultazione in sola lettura.
- I warning sono esclusivamente visivi: si mostrano subito per gli stati non risolti e restano visibili fino alla loro risoluzione. Non sono previste notifiche esterne.
- Il `paymentToken` è visualizzato in chiaro a tutti gli utenti della console. La fase attuale non introduce IAM: identità demo fissa, ricerca token e reveal senza controllo di capacità. I requisiti IAM storici restano un tema futuro, non un prerequisito delle viste attuali.

## 2. Modello di stato da rappresentare

Il sistema non ha un singolo stato di pagamento. La piattaforma deve mantenere separate almeno queste dimensioni:

| Dimensione | Stati riscontrati nel codice |
|---|---|
| Pagamento logico / posizione debitoria | `INSERTED`, `PAYING`, `PAID`, `NOTICE_STORED`, `NOTIFIED` |
| Tentativo (`paymentToken`) | `PAYING`, `PAYING_RPT`, `PAID_NORPT`, `PAID`, `FAILED_NORPT`, `FAILED`, `CANCELLED`, `CANCELLED_NORPT`, `NOTICE_GENERATED`, `NOTICE_STORED`, `NOTICE_SENT`, `NOTIFIED`, `PAYMENT_SENT`, `PAYMENT_REFUSED`, `PAYMENT_SEND_ERROR`, `PAYMENT_ACCEPTED`, `PAYMENT_UNKNOWN`, `PAYMENT_RESERVED` |
| Destinatario ricevuta (terza entità proiettata) | `NOTICE_GENERATED`, `NOTICE_SENT`, `NOTICE_PENDING`, `NOTIFIED` |

Le tre dimensioni sono persistite e mostrate separatamente. Alcune etichette, ad esempio `NOTICE_SENT` e `NOTIFIED`, esistono su più entità: non vanno attribuite a un'entità diversa da quella indicata dall'evento.

I valori possono dipendere dalla versione della primitiva e dal percorso applicativo. La piattaforma deve conservare il valore originale registrato dal Nodo; eventuali categorie normalizzate vanno aggiunte senza sostituirlo. Non usare soltanto gli stati concettuali `Open` e `Closed`.

`docs/analysis/Analisi paymentStatus.md` (API Nodo `GET /paymentstatus`, `POSITION_PAYMENT_STATUS_SNAPSHOT.status`) elenca gli stessi 18 stati del tentativo e vi associa un esito Nodo a 3 valori (`OK` / `IN CORSO` / `KO`). Questo esito è una categoria **aggiuntiva**: la piattaforma lo rimappa aggiungendo la categoria "non risolto" per `PAYMENT_UNKNOWN` e `PAYMENT_SEND_ERROR` (warning solo visivi). Restano due divergenze da chiarire col prodotto, tracciate in `FSM stati di pagamento.md` (sezione "Classificazione esito"): l'analisi classifica `PAYMENT_SEND_ERROR` come `KO` terminale (qui è non risolto/intermedio) e `NOTIFIED` come `OK` (qui `NOTIFIED` non è, da solo, conferma di esito positivo). Gli eventi RE `paymentStatus` sono di categoria `INTERFACCIA` e restano esclusi dal filtro di ammissione (§4).

Il raccordo con `docs/analysis/Analisi status RE.md` non aggiunge stati agli enum: `position_CANCELLED` è una discrepanza aperta rispetto ai 5 stati logici documentati, mentre `payment_SENT`/`payment_ACCEPTED`/`payment_REFUSED`/`payment_SEND_ERROR`/`payment_UNKNOWN` sono grafie da verificare rispetto alla regola prefisso + stato enum (ad esempio `payment_PAYMENT_UNKNOWN`). Nessun alias o nuova transizione è assunto implicitamente; il dettaglio e la copertura di tutti gli stati sono in `FSM stati di pagamento.md`, sezioni «Raccordo con gli status RE» e «Copertura di tutti gli stati e trigger da completare».

### 2.1 Sequenze rilevanti

- `activatePaymentNotice` porta posizione e pagamento a `PAYING`.
- In V2, `closePayment` registra anche `PAYMENT_RESERVED` prima della notifica al PSP; la notifica porta a `PAYMENT_SENT`.
- La risposta PSP distingue `PAYMENT_ACCEPTED`, `PAYMENT_REFUSED`, `PAYMENT_UNKNOWN` e `PAYMENT_SEND_ERROR`.
- `PAYMENT_UNKNOWN` è uno stato non risolto, non un KO terminale: può evolvere a `PAID` quando arriva `sendPaymentOutcome`, oppure essere cancellato successivamente dal flusso asincrono di scadenza.
- Un esito KO o un errore di invio può portare a `CANCELLED` e riportare la posizione a `INSERTED`.
- Nel percorso NM3 attivato presso PSP, `sendPaymentOutcome`/`sendPaymentOutcomeV2` può portare direttamente il tentativo da `PAYING` a `PAID` (OK) o `FAILED` (KO) e la posizione rispettivamente a `PAID` o `INSERTED`, senza il ramo close/notifica PSP. Non estendere il KO NM3 al percorso NM1/appIO, che accetta solo outcome OK.
- `closePayment` KO e gli annulli di validazione di `closePaymentV2` possono annullare i token conosciuti coinvolti e riaprire le posizioni in `INSERTED`; non introducono uno stato logico `CANCELLED`.
- Dopo l'esito positivo, il pagamento e la posizione passano a `PAID`; segue la generazione e l'invio della ricevuta ai destinatari.
- Nel ramo ricevuta, il tentativo può proseguire `PAID → NOTICE_GENERATED → NOTICE_SENT → NOTIFIED`: l'invio alla PA intestataria determina `NOTICE_SENT`, le risposte intellegibili di tutti i destinatari determinano `NOTIFIED`. La posizione raggiunge `NOTIFIED` sulla risposta della PA intestataria, alle condizioni del flusso multibeneficiario, solo se ancora `PAID`; se `NOTICE_STORED`, resta archiviata.
- Timeout, errore di risposta o indisponibilità della PA possono lasciare il destinatario in `NOTICE_PENDING` e attivare retry.
- La transizione del destinatario a `NOTIFIED` indica che è stata ricevuta una risposta. L'esito applicativo OK/KO è una dimensione distinta, non acquisita da questa proiezione: `NOTIFIED` non deve essere interpretato da solo come conferma di esito positivo.

Le timeline delle tre entità mostrano le transizioni senza anticipare un esito definitivo. `PAYMENT_ACCEPTED` significa accettazione PSP in attesa dell'esito, non pagamento acquisito; `FAILED` e `CANCELLED` non sono sinonimi. Un tentativo `PAYMENT_UNKNOWN` non va conteggiato come KO finché non è risolto. L'esito applicativo PA resta fuori dalla proiezione e non va ricavato da `NOTIFIED`.

I percorsi legacy/RPT comprendono i completamenti `PAID_NORPT → PAID`, `FAILED_NORPT → FAILED`, `CANCELLED_NORPT → CANCELLED` e `NOTICE_STORED` secondo il ramo applicativo. Gli archi di ingresso in `PAYING_RPT` e `CANCELLED_NORPT` restano da verificare, senza dedurli dai soli nomi. I retry di `sendPaymentResult` non introducono, da soli, nuovi stati di business; i retry receipt possono completare gli stati di pagamento/tentativo solo alle condizioni descritte nella FSM. In stand-in, invio receipt disabilitato non implica consegna, errore o `NOTICE_STORED`.

### 2.2 Pagamento logico e tentativi

- La coppia `(paFiscalCode, noticeNumber)` identifica il pagamento logico/avviso.
- Ogni `paymentToken` identifica un tentativo distinto, con stato e timeline propri. Tentativi falliti restano consultabili anche quando un tentativo successivo va a buon fine.
- Lo stato del pagamento logico deve provenire dallo stato della posizione identificata dalla coppia PA/NAV; non deve essere calcolato contando i tentativi come pagamenti distinti.
- Se un tentativo ha esito positivo, il pagamento logico va rappresentato come pagato secondo lo stato persistito della posizione, mantenendo visibili gli esiti dei tentativi precedenti.
- Un warning di pagamento non risolto resta associato al relativo token e non deve oscurare lo stato complessivo né cancellare la storia degli altri tentativi.

### 2.3 Dati persistiti

La proiezione funzionale contiene esclusivamente le seguenti informazioni:

| Ambito | Informazioni |
|---|---|
| Pagamento logico | `paFiscalCode`, `noticeNumber`, stato corrente e sequenza degli stati raggiunti con data-ora di ogni passaggio |
| Tentativo | `paymentToken`, `serviceIdentifier`, `psp`, `stazione`, `canale`, `attemptStartedAt` (con indicatore se stimato; può essere assente), stato corrente e sequenza degli stati raggiunti con data-ora di ogni passaggio |
| Destinatario | `recipientId` tecnico, coppia PA/NAV, `stazioneRecipient`, stato e timeline con data-ora/provenienza/trigger, revisione e incompletezza; nessuna associazione a un token o ruolo intestatario dedotti |

`psp`, `stazione` e `canale` sono identificativi tecnici/istituzionali (ad esempio `ABI18164`, `80087670016_01`, `02654890025_01`), conservati come stringhe opache così come ricevuti; la descrizione del PSP non è persistita. Non sono dati personali del pagamento e seguono la retention del tentativo.

La rappresentazione può essere normalizzata in record di pagamento e record di tentativo oppure serializzata in strutture equivalenti. Ogni tentativo memorizza `attemptStartedAt`; ogni elemento di timeline contiene almeno `state`, `transitionAt` e la provenienza temporale (`SOURCE_EVENT`, `INFERRED` oppure `ANOMALY` se la data-ora dell'evento è mancante o non interpretabile; in tal caso `transitionAt` è assente). Tutti i timestamp sono memorizzati e restituiti dalle API in UTC; la conversione dal fuso orario di origine è descritta al §4.1. Gli stati ricostruiti dalla FSM sono marcati come inferiti. In entrambi i casi deve essere possibile recuperare un pagamento logico con tutti i token in retention e la storia temporale del tentativo di ciascun token. La sequenza memorizzata è quella delle transizioni accettate, non una copia indiscriminata degli eventi ricevuti; lo stato corrente è l'ultimo stato della sequenza e non viene duplicato come informazione distinta.

I metadati tecnici necessari sono ammessi e restano separati dalla proiezione funzionale. Comprendono almeno: identificativo tecnico del messaggio Event Hubs per deduplicare le riconsegne; revisione locale della proiezione; checkpoint per partizione; ID/cursore e stato di pubblicazione degli elementi outbox; timestamp tecnici di elaborazione/pubblicazione per misurare la freschezza. Event Hubs non viene modificato e non si presuppone una versione di business nel messaggio. Il dettaglio del modello è definito al §4.4.

## 3. Requisiti funzionali

### 3.1 Ricerca e correlazione

1. La chiave di consultazione del pagamento logico è la coppia codice fiscale PA + NAV. La ricerca per un solo campo può essere offerta come filtro, ma non identifica univocamente un pagamento.
2. La ricerca per `paymentToken` apre il tentativo specifico e il relativo pagamento logico. Token in chiaro e ricerca sono disponibili a tutti gli utenti della console, senza capacità IAM in questa fase. Codice fiscale PA e NAV possono essere indicati come filtri facoltativi aggiuntivi.
3. La scheda della coppia PA/NAV elenca tutti i `paymentToken` correlati. Per ogni token mostra `serviceIdentifier`, `psp`, `stazione`, `canale` e la sequenza degli stati del tentativo.
4. La piattaforma non espone né persiste correlazioni con `transactionId`, `sessionId` o payload ricevuta. I destinatari sono consultati per posizione; il contratto non certifica la relazione al tentativo né la completezza del set: vietati percentuali o conteggi notificati/attesi dedotti dal client.
5. Le ricerche su milioni di record usano indici sulle chiavi di consultazione e paginazione cursor-based. Il backend restituisce solo la pagina richiesta; non effettua scansioni complete né conteggi sincroni dell'intera proiezione per ogni ricerca.

### 3.2 Scheda e timeline

Per ogni pagamento logico, mostrare:

- il codice fiscale, il NAV e la sequenza degli stati del pagamento logico;
- la lista dei `paymentToken` associati;
- per ogni token, `serviceIdentifier`, `psp`, `stazione` e `canale` (mostrati come codici; se un valore non è ancora noto la UI lo indica come non disponibile), data-ora di inizio del tentativo e sequenza degli stati raggiunti, con data-ora di ogni passaggio;
- lo stato corrente distinto dagli stati osservati e inferiti, anche senza colore. La storia conserva ogni occorrenza nell'ordine del servizio; uno schema espandibile separato descrive fasi, alternative e condizioni dei percorsi possibili, non eventi avvenuti;
- un warning sul tentativo per gli stati non risolti previsti, tra cui `PAYMENT_UNKNOWN` e `PAYMENT_SEND_ERROR`, fino alla loro risoluzione.

Ogni tentativo mostra `attemptStartedAt`; ogni passaggio delle tre entità mostra
la data-ora ricavata da `dataOraEvento` (§4.1, §4.3). Gli stati inferiti sono
marcati e usano la data dell'evento che ha consentito l'inferenza, indicata come
stimata. Se la data manca o non è interpretabile, `transitionAt` è nullo e la
provenienza `ANOMALY`: stato e occorrenza restano visibili, senza ripiego sull'ora
browser. Il fuso è quello scelto dall'operatore. L'ordine osservato è la sequenza
accettata dal servizio, non un sort per timestamp o una visita per codice enum.
Ogni occorrenza conserva il trigger sorgente; se assente, la UI indica
«non disponibile». Lo schema FSM spiega cause possibili, non riscrive
`sendPaymentOutcomeV2` in `paSendRTV2` e non aggiunge un esito OK/KO dal solo stato.
Payload, dettagli errori, ricevute complete e outcome applicativo restano esclusi.

La UI non esegue polling né rilegge il database a ogni notifica: riceve tramite SSE l'aggiornamento della proiezione e lo applica localmente. Applica i delta in ordine di `projectionRevision`; se rileva un salto di revisione, esegue un singolo riallineamento mirato della coppia PA/NAV. La lettura API serve inoltre per il caricamento iniziale, la ricerca/paginazione e la riconnessione quando il cursore SSE è scaduto.

**Check DB (23 ottobre 2026):** ogni tentativo offre un controllo manuale,
separato dal flusso SSE. Il backend risolve il database nodo-online dal
`serviceIdentifier` del tentativo e legge separatamente gli snapshot della
posizione (PA/NAV) e del tentativo (paymentToken). La scheda confronta gli stati
osservati con quelli DB, senza modificare la proiezione: coincidente,
discordante oppure non verificabile per record assenti. Mostra servizio e
data-ora del controllo e segnala il confronto come da ripetere dopo una nuova
revisione live. Servizio assente/non configurato e guasto DB sono espliciti.
Nessun payload o dato aggiuntivo viene esposto. Nel mock il controllo è
chiaramente marcato come simulazione; l'accesso DB reale è responsabilità del
backend separato (specifica di superamento mock §4.4).

Il warning non è un allarme esterno né una diagnosi della causa. Le soglie di durata e le regole di escalation non fanno parte della prima fase.

### 3.3 Dashboard

La dashboard deve fornire almeno:

- conteggi per stato, riportati separatamente per pagamenti logici e tentativi;
- conteggi dei pagamenti e dei tentativi non risolti;
- filtri per stato, `serviceIdentifier`, `psp` e `canale`, applicabili ai conteggi e alle liste;
- conteggi dei tentativi per stato ripartiti per `psp` e per `canale`, per individuare dove si concentrano i casi non risolti. Il pagamento logico non ha `psp` né `canale`: questa ripartizione riguarda solo i tentativi;
- traffico per ente creditore (`paFiscalCode`, dal campo `idDominio` del messaggio) e, per ciascun ente, traffico per `stazione` (§3.3.1);
- andamento temporale dei passaggi di stato e durata tra passaggi, basati su `transitionAt` e indicando se il tempo è sorgente o inferito;
- numero di transizioni con data-ora mancante o non interpretabile (`ANOMALY`, §4.1), con accesso alla lista dei pagamenti interessati;
- indicazione della freschezza dei dati e di eventuali ritardi o lacune di acquisizione, ricavata dai metadati tecnici di acquisizione e non dai dati di business.

**Intervallo di osservabilità.** Approvato il 4 novembre 2026. L'intervallo selezionato (preset «ultimi N minuti» o intervallo personalizzato) vale per tutti i dati della dashboard, non solo per traffico e serie: conteggi dei pagamenti logici, dei tentativi e dei destinatari ricevuta per stato, casi non risolti, matrici per `psp`/`canale`/destinatario, anomalie, traffico, andamento, durate e primitive. Un pagamento logico, un tentativo o un destinatario rientra nell'intervallo se ha avuto *attività* nell'intervallo `[from, to)`, cioè almeno una transizione con data valida (per il tentativo anche l'avvio `attemptStartedAt`); uno stato mostrato è sempre quello *corrente* dell'entità. Un pagamento è incluso se ha attività propria o di un suo tentativo o destinatario, e conta solo i tentativi e i destinatari attivi. Le entità prive di qualsiasi data (solo `ANOMALY`) non rientrano in nessun intervallo; restano raggiungibili dalle liste senza intervallo (ad esempio con `anomaliesOnly`). I casi non risolti seguono lo stesso intervallo: un tentativo `PAYMENT_UNKNOWN` senza attività nell'intervallo non è nei conteggi della dashboard, ma resta visibile e filtrabile nella lista dei tentativi (che, senza intervallo, copre l'intera retention). Per gli intervalli predefiniti la finestra è mobile e aperta a destra (`live=true`): l'attività successiva a `to` rientra subito. Le liste aperte dalla dashboard (`/payments`) ricevono gli stessi `from`/`to`/`live`, così il numero di righe coincide con il conteggio da cui si è partiti.

I conteggi di dashboard sono serviti da un read model aggregato aggiornato incrementalmente; le richieste dashboard non devono aggregare ogni volta milioni di record. Le variazioni dei conteggi sono coalesciate/batchate prima del push ai client dashboard, così non viene inviato un messaggio per pagamento a ogni utente connesso. I conteggi derivati non sostituiscono la proiezione dei singoli pagamenti.

Le aggregazioni sono pre-calcolate per famiglie, non come prodotto di tutte le dimensioni: (stato × `serviceIdentifier`), (stato × `psp`), (stato × `canale`), (`paFiscalCode` × stato) e (`paFiscalCode` × `stazione` × intervallo temporale). Una combinazione di filtri non coperta da una famiglia (ad esempio `psp` e `canale` insieme) non produce conteggi aggregati: restituisce solo la lista paginata dei tentativi, letta tramite gli indici (§4.4). Quando `psp`, `canale` o `stazione` di un tentativo non sono ancora noti, il tentativo è conteggiato sotto "non disponibile" e viene spostato dalla variazione che ne registra l'acquisizione.

#### 3.3.1 Traffico per ente creditore e per stazione

- **Definizione.** Il traffico è il numero di tentativi avviati nell'intervallo selezionato, attribuiti all'intervallo di `attemptStartedAt`. Per ogni ente creditore si mostrano inoltre il numero di pagamenti logici per stato corrente e il numero di tentativi non risolti. I tentativi con `attemptStartedAt` assente concorrono ai conteggi per stato solo se hanno altre transizioni datate nell'intervallo, e non concorrono alle serie temporali.
- **Vista per ente.** Elenco paginato (cursor-based) degli enti creditori ordinabile per volume di traffico e per numero di casi non risolti, con ricerca per codice fiscale. Non è un elenco completo trasmesso al browser.
- **Vista per stazione.** Aprendo un ente si mostra il traffico ripartito per `stazione` (le stazioni verso cui i tentativi di quell'ente sono stati instradati), con ripartizione per stato e andamento nell'intervallo. Dalla stazione si accede alla lista paginata dei pagamenti corrispondenti.
- **Aggiornamento.** Il client riceve via SSE i delta aggregati solo per l'ente o la stazione che sta visualizzando, coalesciati come gli altri conteggi. Le serie per ente e stazione seguono la retention di 60 giorni (§4.4).

#### 3.3.2 Primitive inviate per `serviceIdentifier`

Approvata il 2 novembre 2026. La dashboard mostra il volume delle primitive inviate, ripartito per `serviceIdentifier`.

- **Definizione.** Si contano gli eventi RE di richiesta (`REQ`) delle primitive nell'intervallo selezionato, attribuiti al `serviceIdentifier` del tentativo; ogni richiesta è abbinata alla relativa risposta (`RESP`). Per ogni servizio la dashboard riporta richieste, risposte e quota percentuale sul totale; il totale è evidenziato sopra l'istogramma. Ogni servizio si espande nel dettaglio per primitiva (`tipoEvento` RE, nome originale) con gli stessi conteggi, la quota sul servizio e i warning.
- **Direzione.** Approvato il 4 novembre 2026. Ogni conteggio è ripartito per direzione rispetto al Nodo, calcolata dal backend sui campi RE `fruitore` ed `erogatore` dell'evento `REQ` (mai dedotta dal nome della primitiva): **in ingresso** (`INBOUND`) se il Nodo è l'`erogatore`, cioè altri sistemi lo chiamano (es. `verifyPaymentNotice`, `activatePaymentNotice`, `sendPaymentOutcome`, `closePayment`, `checkPosition`); **in uscita** (`OUTBOUND`) se il Nodo è il `fruitore`, cioè chiama una PA o un PSP (es. `paVerifyPaymentNotice`, `paGetPayment`, `paSendRT`, `pspNotifyPayment`); **non determinata** (`UNKNOWN`) se nessuno dei due è il Nodo o i campi sono assenti, senza attribuzioni per ipotesi. La dashboard suddivide per direzione le primitive di ciascun gruppo di natura (Consultazione, Pagamento, Altre), con il totale per direzione, e indica la direzione di ogni primitiva nel dettaglio di un servizio; una riga senza direzione riconosciuta compare come non determinata. La direzione è una dimensione dei conteggi (`serviceIdentifier`, primitiva, direzione) e delle chiavi dei delta SSE; il dettaglio dei warning resta per primitiva.
- **Warning.** Una richiesta senza risposta entro **10 secondi** (risposta tardiva o assente) è un warning, solo visivo, come gli altri (icona + testo, nessuna notifica). Una richiesta ancora entro i 10 secondi è in attesa e non è un warning. Il conteggio dei warning è riportato per servizio e nel totale.
- **Natura delle primitive.** Approvato il 4 novembre 2026. Il totale conta ogni richiesta `REQ` ammessa, comprese le consultazioni (`verifyPaymentNotice`, `paVerifyPaymentNotice`, `checkPosition`) che non creano né fanno avanzare pagamenti, quindi non è confrontabile con i conteggi di pagamenti e tentativi. La dashboard etichetta il totale come «chiamate di primitiva» e lo ripartisce in **Consultazione**, **Pagamento** (attivazione, chiusura, esito, ricevuta) e, se presenti, **Altre** (primitive non classificate, mai attribuite per ipotesi). La classificazione è per nome originale della primitiva (senza distinguere il suffisso `V2`), definita in un unico punto del frontend (`primitive-nature.ts`); il backend continua a restituire i conteggi per `serviceIdentifier` e primitiva.
- **Dettaglio dei warning.** Approvato il 3 novembre 2026. Dalla riga di una primitiva, il conteggio dei warning si apre su un elenco paginato delle singole chiamate senza risposta entro 10 secondi, dalla più recente: **data-ora della chiamata, PSP, canale, ente (codice fiscale PA) e stazione**, con le stesse finestra e gli stessi filtri della dashboard. Un valore assente è mostrato come «Non disponibile». L'elenco è caricato su richiesta all'apertura della riga e non si aggiorna via SSE; nessun `paymentToken`, NAV, `sessionId` né payload.
- **Filtri e finestra.** Segue la finestra temporale e i filtri della dashboard (stato, `serviceIdentifier`, `psp`, `canale`) e si aggiorna via SSE (`aggregate.delta`) come gli altri conteggi. Per gli intervalli predefiniti («ultimi N minuti») la finestra è mobile: il client invia `live=true` insieme a `from`/`to` e il conteggio resta aperto a destra, così le richieste successive all'apertura dello stream compaiono subito nei delta SSE senza ricaricare; per un intervallo personalizzato la finestra è chiusa [from,to).
- **Perimetro dati.** Sono persistiti i conteggi aggregati per minuto (richieste, risposte, warning per `serviceIdentifier`, direzione, `psp`, `canale`, `stazione`) e, solo per le chiamate in warning, un record con `serviceIdentifier`, primitiva, `psp`, `canale`, `paFiscalCode`, `stazione` e data-ora della richiesta (eccezione approvata il 3 novembre 2026 al solo-aggregato; retention 60 giorni, §4.4): nessun payload né dato di pagamento. Per abbinare REQ e RESP il backend usa `sessionId` + `tipoEvento` in una tabella di lavoro transitoria, cancellata a chiamata chiusa o dopo 5 minuti: è un'eccezione approvata il 2 novembre 2026 al divieto di persistere `sessionId` (§3.1), limitata all'abbinamento. I filtri di stato, anomalia ed ente non si applicano ai conteggi. L'abbinamento REQ/RESP e la verifica dei 10 s spettano al consumer backend; il frontend non legge RE per questa vista.
- **Contratto.** `Overview.primitives` e `changes.primitives` di `aggregate.delta` (`docs/api/openapi.json`, schema `PrimitiveCount`, con `direction`); dettaglio dei warning in `GET /api/overview/primitive-warnings` (schema `PrimitiveWarningPage`). Il mock simula le chiamate dai passaggi di stato sorgente: `PAYMENT_UNKNOWN` risponde dopo 12 s, `PAYMENT_SEND_ERROR` non risponde mai.

### 3.4 Scenario utente principale: monitoraggio generale

1. L'operatore apre la dashboard e vede una fotografia aggiornata dell'intero sistema: conteggi dei pagamenti logici per stato, conteggi dei tentativi per stato, casi non risolti e freschezza dell'acquisizione. Pagamenti logici e tentativi sono conteggiati separatamente.
2. Mentre la dashboard resta aperta, il backend invia via SSE aggiornamenti aggregati dei conteggi e della freschezza. Il browser non riceve lo stream completo dei pagamenti e non interroga il database a intervalli regolari.
3. L'operatore seleziona un conteggio, uno stato o un `serviceIdentifier`. Il sistema apre una lista paginata dei pagamenti corrispondenti; vengono letti solo i risultati della pagina. Gli aggiornamenti dei record visibili possono arrivare via SSE senza ricaricare l'intero elenco.
4. L'operatore apre una riga, identificata da codice fiscale PA + NAV. Questo dettaglio mostra la sequenza degli stati del pagamento logico e tutti i `paymentToken`, ciascuno con la propria sequenza degli stati del tentativo. Il dettaglio resta aggiornato in push mentre è aperto.
5. Da un conteggio o da un elemento non risolto l'operatore può quindi passare dal quadro generale al singolo pagamento e ai suoi tentativi, senza refresh manuali.
6. Dalla vista per ente creditore (§3.3.1) l'operatore individua gli enti con più traffico o più casi non risolti, apre un ente per vedere il traffico per stazione, quindi apre una stazione per la lista paginata dei pagamenti e da questa il singolo pagamento. Lo stesso percorso è disponibile da un `psp` o da un `canale` selezionato nei conteggi per stato.

La dashboard può mostrare sia la distribuzione corrente sia l'andamento temporale ricavato dai timestamp dei passaggi di stato. I passaggi inferiti hanno un'ora stimata e sono distinguibili nel grafico o esclusi dal calcolo delle durate.

## 4. Sorgenti dati e acquisizione

### 4.1 Acquisizione e aggiornamento della proiezione

La sorgente è il topic Event Hubs del Registro Eventi (RE) del Nodo, consumato da un componente backend dedicato. Il frontend non consuma direttamente Event Hubs. Il topic non contiene solo cambi di stato: trasporta anche gli eventi di interfaccia (`REQ`/`RESP` delle primitive, con `payload` in base64), gli stati RPT/carrello e gli stati dei destinatari della ricevuta. Il consumer applica quindi un filtro prima di qualsiasi elaborazione.

**Filtro di ammissione.** Un messaggio è elaborato solo se `esito = CAMBIO_STATO` **e** `status` inizia per `payment_`, `position_` oppure `receipt_recipient_`. Tutti gli altri messaggi sono scartati senza essere persistiti né registrati nell'inbox, in particolare:

- gli eventi di interfaccia (`categoriaEvento = INTERFACCIA`): il loro `payload` non viene mai letto né salvato;
- gli stati senza prefisso, che appartengono a RPT e carrello.

Il prefisso determina l'entità cui lo stato appartiene: `payment_X` è uno stato del tentativo, `position_X` è uno stato del pagamento logico. Etichette uguali con prefisso diverso (ad esempio `payment_NOTIFIED` e `position_NOTIFIED`) sono stati di entità diverse e non vanno fuse. Il valore dopo il prefisso è conservato così come registrato dal Nodo (§2).

**Validazione dello stato dopo il filtro.** Il filtro di prefisso non rende automaticamente valido qualunque suffisso: lo stato deve appartenere all'enum dell'entità e la transizione deve essere ammessa (§4.3). Per esempio `payment_PAYMENT_UNKNOWN` identifica `PAYMENT_UNKNOWN`; `payment_UNKNOWN` non viene rinominato silenziosamente e `position_CANCELLED` non viene applicato come annullo di un tentativo o riapertura a `INSERTED`. Un valore non riconosciuto non aggiorna proiezione o conteggi e non produce un delta di business: viene segnalato come anomalia tecnica di risoluzione FSM, senza persistere il payload. Occorre confermare grafia/versione sorgente prima di estendere enum o mapping.

**Mappatura dei campi.** Il consumer legge soltanto i campi seguenti; ogni altro campo del messaggio è ignorato.

| Campo del messaggio | Uso nella proiezione |
|---|---|
| `idDominio` | `paFiscalCode` |
| `noticeNumber` | `noticeNumber` (non usare `iuv` o `creditorReferenceId`) |
| `paymentToken` | `paymentToken`; presente sugli eventi `payment_*`, assente sugli eventi `position_*` (non usare `ccp`) |
| `status` | stato dopo rimozione del prefisso `payment_`/`position_`/`receipt_recipient_`; il prefisso seleziona l'entità |
| `info.stazione_recipient` | stazione del destinatario per i soli eventi `receipt_recipient_*`, non stazione del tentativo |
| `tipoEvento` | provenienza del trigger della transizione, se presente sul cambio stato ammesso; non autorizza a leggere eventi di interfaccia o payload |
| `dataOraEvento` | `transitionAt` e, per il primo `payment_PAYING` del token, `attemptStartedAt` (§4.3) |
| `serviceIdentifier` | `serviceIdentifier` del tentativo |
| `psp` | `psp` del tentativo (solo eventi `payment_*`) |
| `stazione` | `stazione` del tentativo (solo eventi `payment_*`) |
| `canale` | `canale` del tentativo (solo eventi `payment_*`) |
| `uniqueId` | chiave di deduplica (§4.4) |

`psp`, `stazione` e `canale` non sono necessariamente valorizzati su ogni evento (ad esempio `stazione` può mancare in alcuni percorsi). Il tentativo li acquisisce dal primo evento `payment_*` che li porta e completa i valori mancanti con quelli degli eventi successivi. Un valore non nullo diverso da quello già acquisito non lo sovrascrive: è registrato come anomalia tecnica. L'acquisizione o il completamento di un valore incrementa `projectionRevision` e viene notificato come delta. Sugli eventi `position_*` i tre campi sono ignorati, perché non attribuibili a un tentativo.

`tipoEvento` descrive la provenienza applicativa del cambio stato, non necessariamente la chiamata di trasporto che lo precede immediatamente. In `docs/analysis/re_messages.json`, ad esempio, `payment_NOTIFIED` e `receipt_recipient_NOTICE_SENT` riportano `tipoEvento = sendPaymentOutcomeV2`: non si deve sostituirlo automaticamente con `paSendRTV2`. Il campo `trigger` della timeline (§3.2) conserva la provenienza disponibile; la tabella FSM spiega le possibili cause applicative, ma non permette di sceglierne una dal solo stato finale. Se la causa non è determinabile, resta non disponibile, senza inventare OK/KO, timeout o scadenza.

Un messaggio ammesso privo di `idDominio` o `noticeNumber`, oppure un evento `payment_*` privo di `paymentToken`, non può essere correlato: non aggiorna la proiezione, è registrato come anomalia tecnica (§4.4, risoluzione FSM) e non produce notifiche.

**Elaborazione.** Il consumer individua il pagamento logico tramite `(paFiscalCode, noticeNumber)` e, per gli eventi `payment_*`, il tentativo tramite `paymentToken`, quindi aggiorna la proiezione funzionale. Gli eventi `position_*` aggiornano esclusivamente il pagamento logico: non contengono il token e non possono essere attribuiti a un tentativo.

**Timestamp e fuso orario.** `dataOraEvento` ha formato `yyyy-MM-dd'T'HH:mm:ss.SSS`, privo di indicazione del fuso, ed è prodotto dal Nodo in ora locale `Europe/Rome` (CET/CEST). Il consumer lo converte in UTC con le regole del database IANA `Europe/Rome`, non con un offset fisso, e memorizza solo il valore UTC; l'ora locale originale non è conservata. Casi di confine:

- **Ora legale → solare (ultima domenica di ottobre, 03:00 → 02:00).** Gli orari locali 02:00–02:59 compaiono due volte e il messaggio non indica quale. Il consumer interpreta sempre l'orario come prima occorrenza (ora legale, UTC+2). È una discrepanza accettata: gli eventi della seconda occorrenza risultano anticipati di un'ora in UTC, una sola volta l'anno, e le durate calcolate attraverso quell'intervallo possono essere alterate o negative. L'ordine della progressione non ne è influenzato perché deriva dalla FSM.
- **Ora solare → legale (ultima domenica di marzo, 02:00 → 03:00).** Gli orari locali 02:00–02:59 non esistono. Se un messaggio ne porta uno, il consumer applica lo spostamento in avanti standard e registra un'anomalia tecnica.
- **`dataOraEvento` mancante o non interpretabile.** L'evento non è scartato: la transizione è applicata (lo stato è noto e l'ordine deriva dalla FSM), ma `transitionAt` resta assente e l'elemento di timeline ha provenienza `ANOMALY`. L'anomalia è visibile all'operatore (§3.2) e conteggiata in dashboard (§3.3). Un elemento `ANOMALY` è escluso dai calcoli di durata e di andamento. Se la stessa transizione è ripubblicata con un `dataOraEvento` valido, il timestamp sostituisce l'anomalia (incrementando `projectionRevision`, senza riapplicare la transizione).

La precisione è al millisecondo: transizioni distinte nello stesso millisecondo hanno lo stesso timestamp e restano ordinate dalla FSM, non dal tempo.

L'aggiornamento del pagamento/tentativo, la revisione locale della proiezione, la registrazione del messaggio elaborato, l'append della transizione accettata e, solo se la proiezione cambia, la scrittura dell'elemento outbox devono avvenire nella stessa transazione DB. Il consumer conferma il checkpoint Event Hubs solo dopo il commit. Elaborazioni ripetute devono essere idempotenti; errori persistenti devono essere resi osservabili e non trasformati in aggiornamenti riusciti.

### 4.2 Outbox, aggiornamento e lettura

L'outbox non serve a rileggere il pagamento dopo ogni scrittura: serve a pubblicare in modo affidabile l'aggiornamento già committato. Il flusso è:

1. Il consumer riceve un evento da Event Hubs.
2. In un'unica transazione DB registra il messaggio, risolve la transizione tramite la FSM, aggiorna la proiezione e la sua revisione locale e inserisce una riga outbox solo se c'è una modifica visibile. La riga outbox contiene la revisione, il delta della proiezione ammesso dal §2.3 e il delta necessario ad aggiornare i contatori; non contiene il payload originale dell'evento. Un duplicato o un evento scartato come regressivo non genera una notifica.
3. Dopo il commit, il consumer conferma il checkpoint Event Hubs. Se si interrompe dopo il commit ma prima del checkpoint, l'evento può essere riconsegnato: la deduplicazione impedisce una seconda applicazione della transizione.
4. Un publisher legge le righe outbox non ancora inoltrate e invia tramite un canale condiviso due tipi di aggiornamento SSE: delta del pagamento ai client sottoscritti a quella coppia PA/NAV e delta aggregati dei contatori ai client della dashboard. Il read model dei contatori applica ogni delta una sola volta usando `outboxId`; il publisher coalesca/batcha gli aggiornamenti dei contatori prima del fan-out. I delta contengono revisione e soli dati modificati, sufficienti ad aggiornare le viste senza query DB per evento. Dopo l'acknowledgement del canale il publisher marca la riga come inoltrata. Se si interrompe dopo l'invio ma prima della marcatura, può inviare un duplicato: il client/read model lo riconosce dalla revisione/cursore e non duplica l'aggiornamento. La marcatura indica l'inoltro al canale, non la ricezione da parte di ogni browser.
5. Il frontend applica l'aggiornamento ricevuto senza interrogare il database per ogni evento. L'API legge la proiezione dal database per la ricerca iniziale/paginata e per il riallineamento, non per ogni notifica SSE.

Per evitare una finestra di perdita, il frontend apre prima la sottoscrizione SSE autorizzata e limitata alla coppia PA/NAV consultata, accodando gli eventi; poi legge lo snapshot via API e applica solo i delta con `projectionRevision` maggiore della revisione dello snapshot. Il publisher preserva l'ordine per coppia. Alla riconnessione il client riprende dal cursore SSE, oppure rilegge solo la coppia/la pagina aperta se il cursore è scaduto. Il backend non trasmette a ogni client tutti gli eventi dei milioni di pagamenti. In un deployment con più istanze, il canale condiviso raggiunge i client collegati a tutte le istanze.

### 4.3 Risoluzione dello stato e prevenzione delle regressioni

- Il consumer usa i dati già presenti nel messaggio (tipo evento, chiavi e stato/esito disponibili) per mapparlo a una transizione della FSM. Il messaggio non viene interpretato come una versione temporale e non è necessario modificare Event Hubs.
- Le transizioni sono valutate separatamente per pagamento logico `(paFiscalCode, noticeNumber)` e tentativo `(paFiscalCode, noticeNumber, paymentToken)`. Gli aggiornamenti dello stesso pagamento logico sono serializzati tramite lock o compare-and-set DB; pagamenti con chiavi diverse restano elaborabili in parallelo. Così consumer concorrenti non possono sovrascrivere uno stato più avanzato.
- Si applicano solo transizioni ammesse dalla FSM corrente. Duplicati, no-op e transizioni all'indietro sono ignorati; un tentativo terminale non viene riaperto da un evento tardivo dello stesso `paymentToken`. Una nuova attivazione con token diverso è invece valutata come nuovo tentativo e non viene scartata solo perché esiste un token precedente.
- Se arriva per primo un evento di stato successivo (ad esempio `closePayment`) e poi un evento `activatePaymentNotice` riferito allo stesso tentativo, il consumer mantiene lo stato avanzato e scarta l'attivazione tardiva perché non è una transizione valida dallo stato corrente. Non pubblica una regressione al frontend.
- Se l'evento successivo implica una sequenza di stati precedenti univoca nella FSM, il consumer può ricostruire tali stati come raggiunti. Se la FSM ammette più percorsi compatibili o il messaggio non contiene dati sufficienti a identificare il tentativo/transizione, non deve inventare una storia: registra l'anomalia tecnica e marca la timeline come incompleta fino alla riconciliazione.
- In particolare, `PAID` non implica sempre `PAYMENT_ACCEPTED` (esiste il ramo NM3 diretto) e `PAYMENT_RESERVED` non implica sempre un precedente `PAYING` del token (V1 PA OLD può creare direttamente il payment). `PAID` può ancora evolvere negli stati di ricevuta del tentativo; `CANCELLED` non va riaperto genericamente. Le eccezioni legacy `CANCELLED_NORPT` non autorizzano una transizione da `CANCELLED`.
- `attemptStartedAt` viene fissato usando `dataOraEvento` del primo evento `payment_PAYING` del token (base temporale `SOURCE_EVENT`). Se per quel token arriva prima un evento di stato successivo, `attemptStartedAt` è provvisoriamente il `dataOraEvento` di quel primo evento osservato, marcato come stimato (è un limite superiore dell'avvio reale). Un evento `payment_PAYING` tardivo non cambia lo stato, ma sostituisce la stima con `dataOraEvento` originario e può correggere il timestamp di una transizione inferita. La correzione temporale incrementa `projectionRevision` e viene notificata al frontend senza riapplicare la transizione; non estende la retention (§1).
- Per ogni transizione accettata `transitionAt` è `dataOraEvento` del messaggio, con base `SOURCE_EVENT`: per gli eventi `CAMBIO_STATO` è l'ora in cui il Nodo ha registrato il cambio di stato, convertita in UTC (§4.1). Non esiste un ripiego su `EnqueuedTimeUtc`: se `dataOraEvento` manca o non è interpretabile la transizione è accettata con `transitionAt` assente e provenienza `ANOMALY` (§4.1). Un `payment_PAYING` privo di timestamp valido lascia `attemptStartedAt` assente; la retention del tentativo decorre allora dalla data tecnica di prima elaborazione (§4.4). Il timestamp non viene usato per stabilire se un evento è regressivo: l'ordine deriva dalla FSM.
- Gli eventi `position_*` seguono le stesse regole sul pagamento logico, ma senza token: non fissano mai `attemptStartedAt`. Un evento `position_*` che implica uno stato precedente del pagamento logico ricostruibile in modo univoco dalla FSM può inferirlo; non può inferire stati di un tentativo.
- La proiezione non genera annulli per scadenza locale né ricostruisce gruppi NMU o destinatari assenti dal servizio: attende i cambi stato prodotti dal Nodo. `position_NOTIFIED`, `payment_NOTIFIED` e `receipt_recipient_NOTIFIED` non si sostituiscono tra loro e nessuno dimostra da solo l'esito applicativo OK.
- L'Event Hubs sequence number/offset identifica il messaggio di trasporto e supporta deduplica/checkpoint nella propria partizione; non è un ordinamento globale del workflow. La revisione locale cresce solo quando la proiezione cambia e serve a ordinare aggiornamenti DB/SSE, non a stabilire l'anzianità dell'evento sorgente.

### 4.4 Metadati tecnici

I metadati tecnici, separati dai dati di business, devono includere:

- **Inbox/deduplicazione:** chiave primaria `uniqueId` del messaggio RE, oltre a timestamp/esito di elaborazione. `uniqueId` è un hash a 64 bit calcolato dal Nodo sul contenuto dell'evento (`dataOraEvento`, `status`, `noticeNumber`, `paymentToken`, `idDominio`, sessione e altri campi), non un identificativo casuale: una riconsegna dello stesso messaggio ha lo stesso `uniqueId`, mentre la ripubblicazione della stessa transizione con un `dataOraEvento` diverso ha un `uniqueId` diverso e viene resa no-op dalla FSM. Per questo la deduplica su `uniqueId` non sostituisce la FSM, la affianca. Se `uniqueId` manca, la chiave tecnica di ripiego è `(eventHub, partitionId, sequenceNumber)`, che identifica solo la riconsegna dello stesso messaggio di trasporto. Le registrazioni sono conservate per 60 giorni.
- **Revisione locale:** `projectionRevision` per pagamento logico `(paFiscalCode, noticeNumber)`, incrementata atomicamente a ogni modifica accettata del pagamento o di uno dei suoi tentativi. È inclusa in API, outbox e SSE per scartare aggiornamenti locali obsoleti; non pretende di rappresentare l'ordine originario degli eventi.
- **Data di inizio e retention:** `attemptStartedAt` per ogni `paymentToken`; scadenza calcolata come `attemptStartedAt + 60 giorni`, indipendentemente dagli aggiornamenti successivi. Se `attemptStartedAt` è assente (anomalia, §4.1) la scadenza decorre dalla data tecnica di prima elaborazione del token, memorizzata tra i metadati e non esposta come dato funzionale. Il cleanup elimina ogni tentativo e la relativa timeline alla propria scadenza; conserva il pagamento logico finché esiste almeno un tentativo non scaduto, poi elimina la timeline logica residua e aggiorna contatori e viste live. Duplicati o eventi regressivi non reimpostano `attemptStartedAt`; un timestamp evento originario attendibile può correggere una precedente stima.
- **Timestamp di transizione:** `transitionAt` e `timestampBasis` per ogni passaggio di stato, conservati insieme allo stato. Per gli stati inferiti si conservano anche l'indicatore di inferenza e la base temporale della stima.
- **Checkpoint Event Hubs:** consumer group, partizione e offset/sequence number confermato, nel checkpoint store previsto dal client Event Hubs. Il checkpoint viene avanzato soltanto dopo il commit DB.
- **Outbox:** `outboxId`/cursore SSE riprendibile, chiave dell'aggregato, `projectionRevision`, delta aggiornato limitato ai dati funzionali ammessi, delta dei contatori aggregati, timestamp di creazione, stato, numero di retry e timestamp di ultimo tentativo/pubblicazione. Il delta è preferito allo snapshot completo per contenere volume e duplicazione. Le righe inoltrate sono eliminate dopo 60 giorni; quelle non inoltrate sono soggette ad allarme operativo e non vengono rimosse silenziosamente. Il checkpoint Event Hubs resta disponibile per tutta la vita del consumer group attivo.
- **Risoluzione FSM:** esito tecnico della risoluzione e indicatore di timeline incompleta/da riconciliare quando il messaggio non consente di ricostruire senza ambiguità le transizioni precedenti.
- **Accesso efficiente:** indici sulle chiavi `(paFiscalCode, noticeNumber)` e `paymentToken`, paginazione cursor-based e, dove necessari ai filtri e alle liste della dashboard, indici su stato, `serviceIdentifier`, `psp`, `canale`, `paFiscalCode` e `stazione`. Cache/read model dei conteggi dashboard sono aggiornati in modo incrementale, deduplicati con `outboxId` e ricostruibili dalla proiezione; non sono la fonte autorevole. Le richieste dashboard leggono questi aggregati, mai l'intera proiezione.
- **Freschezza e diagnosi:** ultimo checkpoint/ultimo evento elaborato per partizione e timestamp di pubblicazione; errori e retry del publisher sono metriche/log tecnici. Questi dati supportano il monitoraggio della pipeline e non diventano campi funzionali del pagamento.

La pubblicazione usa SSE perché il flusso è unidirezionale; WebSocket è un'alternativa solo se è necessario un canale bidirezionale. La notifica non contiene payload originali non ammessi. La frequenza è real-time best effort; il target quantitativo di latenza è da concordare.

## 5. Sicurezza e accesso

- Il token è in chiaro a tutti gli utenti della console. In questa fase l'accesso è libero e la sessione locale mantiene un'identità demo fissa; ricerca token e reveal non richiedono capacità.
- Autenticazione/autorizzazione reali saranno responsabilità del backend quando introdotte; la precedente previsione di privilegi separati non è una policy della fase corrente.
- Registrare gli accessi e le ricerche che espongono il token in chiaro, usando il sistema di audit previsto e senza ampliare la proiezione funzionale dei pagamenti.
- Non riportare token in chiaro nei log tecnici della piattaforma, negli eventi di telemetria o nei messaggi di errore.
- Limitare i dati personali e i payload di pagamento ai soli campi indispensabili all'osservabilità; definire cifratura e ruoli prima del rilascio. I dati funzionali sono soggetti alla retention di 60 giorni.

## 6. Vincoli e osservazioni sul codice esistente

- Il Nodo persiste snapshot correnti e storico dei cambi di stato: non è quindi corretto trattare il flusso come un'unica FSM lineare o assumere event sourcing completo.
- Il codice V2 di `closePayment` usa `PAYMENT_RESERVED`, come V1; la FSM documenta entrambe le versioni.
- L'enum applicativo del pagamento comprende anche stati legacy/di ricevuta (`PAID_NORPT`, `FAILED_NORPT`, `CANCELLED_NORPT`, `NOTICE_STORED`), mantenuti nella FSM e nel perimetro degli stati del tentativo; gli archi ancora privi di evidenza sono esplicitati come da verificare.
- Pagamento, archiviazione e consegna sono fasi distinte: la proiezione mantiene le tre entità senza acquisire il payload ricevuta.
- `PAYMENT_UNKNOWN` richiede visibilità come stato pendente e non deve essere perso in una semplice classificazione OK/KO. `NOTICE_PENDING` appartiene esclusivamente al destinatario proiettato, non al tentativo.
- La configurazione Prometheus individuata espone metriche di processo/JVM; nel setup esaminato non risultano metriche di business per conteggi, esiti e latenze del ciclo di pagamento.
- Gli eventi Event Hubs possono essere duplicati o osservati fuori ordine rispetto ad altri processi di aggiornamento; la progressione non può basarsi sull'ordine di ricezione.

## 7. Aspetti da definire prima dell'implementazione

1. Target quantitativo di latenza real-time, volumi, retention, numero di stream simultanei, fan-out e requisiti di disponibilità.
2. Conferma su un campione reale dei campi dei messaggi RE (§4.1). Il mapping è stato verificato sul codice e su 10 messaggi di esempio, che però non contengono gli stati intermedi (`payment_PAYING`, `payment_PAYMENT_RESERVED`, `payment_PAYMENT_SENT`, `payment_PAYMENT_UNKNOWN`, `payment_PAYMENT_SEND_ERROR`) né eventi `position_*`: vanno acquisiti esempi per ciascuno e verificata l'unicità di `uniqueId`. Risolvere le discrepanze di `Analisi status RE.md` (`position_CANCELLED` e grafie abbreviate `payment_SENT`/`ACCEPTED`/`REFUSED`/`SEND_ERROR`/`UNKNOWN`) e campionare i trigger legacy ancora incompleti, senza introdurre alias prima della conferma. Testare la conversione `Europe/Rome` → UTC sui due cambi di ora (ora ambigua e ora inesistente, §4.1). Definire il fallback quando mancano chiavi o dati per risolvere la FSM. Event Hubs e il contratto sorgente non sono modificabili.
3. Definizione della retention dei log operativi e delle metriche, distinta dalla retention funzionale di 60 giorni e dai metadati tecnici descritti al §4.4.
4. Privilegi e policy di audit per le operazioni di ricerca per token e reveal; la visualizzazione ordinaria è disponibile a tutti gli utenti autenticati.
5. Elenco definitivo degli stati e dei percorsi/versioni da coprire, inclusi legacy e casi NMU.
6. Definizione delle finestre temporali e delle aggregazioni della dashboard, distinguendo timestamp evento e stati inferiti, inclusa la granularità delle serie per ente creditore e stazione e il volume atteso di enti e stazioni da gestire.

## 8. Criteri di accettazione iniziali

- Cercando una coppia PA/NAV, l'operatore vede il pagamento logico e la lista completa dei relativi `paymentToken`.
- Per ogni pagamento logico, la progressione distingue gli stati raggiunti, evidenziati in verde, da quelli non ancora raggiunti.
- Per ogni `paymentToken`, l'operatore vede `serviceIdentifier`, `psp`, `stazione`, `canale`, `attemptStartedAt` e la data-ora di ogni passaggio della sequenza di stati; i tentativi precedenti restano consultabili anche quando ne viene avviato uno nuovo.
- Conteggi e dashboard distinguono i pagamenti logici dai tentativi, evitando di contare ogni token come un pagamento autonomo.
- La dashboard mostra i tentativi per stato ripartiti per `psp` e per `canale` e consente di filtrare per entrambi.
- Per ogni ente creditore (`paFiscalCode`) la dashboard mostra il traffico nell'intervallo selezionato; aprendo un ente mostra il traffico per `stazione`, da cui si raggiunge la lista dei pagamenti corrispondenti.
- Un evento con `dataOraEvento` mancante o non interpretabile non viene scartato: la transizione compare nella timeline marcata come anomalia, senza data, ed è conteggiata nell'indicatore di anomalie della dashboard.
- Un pagamento in `PAYMENT_UNKNOWN` è presentato come irrisolto e può evolvere a `PAID` o a cancellazione senza che la piattaforma abbia già registrato un KO definitivo.
- Il database funzionale contiene codice fiscale, NAV, `paymentToken`, stato del pagamento, stati/tentativi di pagamento, `serviceIdentifier`, data di inizio del tentativo e data-ora di ogni passaggio di stato; i metadati tecnici sono separati.
- Un evento duplicato, obsoleto o non valido non provoca regressioni né duplica transizioni nella storia.
- Un suffisso RE non riconosciuto, come `position_CANCELLED` o `payment_UNKNOWN` nel contratto attuale, produce un'anomalia tecnica senza aggiornare stati/conteggi e senza essere convertito in un altro stato o attribuito a un'altra entità.
- Un outcome NM3 diretto non fa inventare il ramo close/PSP; un tentativo `PAID` può proseguire fino a `NOTIFIED` senza essere riaperto finanziariamente. I cambi del destinatario restano separati e una risposta applicativa PA KO non viene presentata come successo dedotto da `NOTIFIED`.
- Il trigger visualizzato proviene dal cambio stato ammesso quando disponibile: il solo arrivo in `CANCELLED` non basta a scegliere tra close KO, result KO e scadenza. `tipoEvento = sendPaymentOutcomeV2` su `payment_NOTIFIED` non viene rinominato in `paSendRTV2` né arricchito leggendo il payload.
- Se `closePayment` viene elaborato prima di `activatePaymentNotice` sullo stesso token, l'attivazione tardiva non sovrascrive lo stato né viene inviata come regressione al frontend; l'attivazione di un token nuovo resta valutabile come nuovo tentativo.
- Le notifiche SSE aggiornano la vista aperta senza polling o una lettura DB per ogni evento; dopo una riconnessione il client riprende dal cursore o ricarica solo la pagina corrente.
- Se il frontend rileva un salto di `projectionRevision`, riallinea una sola volta la coppia interessata invece di continuare a interrogare il database.
- Le ricerche e i conteggi restano efficienti su milioni di record grazie a indici, paginazione e aggregazioni/cache derivate; nessuna richiesta utente esegue una scansione completa sincrona.
- Ogni tentativo e la relativa timeline vengono eliminati 60 giorni dopo il proprio `attemptStartedAt`; il pagamento logico viene eliminato quando non ha più tentativi in retention.
- Un utente non autenticato non può consultare né visualizzare il token; ogni utente autenticato può visualizzarlo in chiaro, indipendentemente dal ruolo.

## 9. Riferimenti al codice esaminato

Percorsi relativi alla root del repository `pagopa-nodo4-nodo-dei-pagamenti`:

- Chiavi e relazione tra posizione, attivazione e tentativo: `nodo4/src/main/scala/eu/sia/pagopa/common/repo/online/model/PaymentPositions.scala:65-76,90-98`; stati e timestamp dei modelli: `nodo4/src/main/scala/eu/sia/pagopa/common/repo/online/model/PaymentPositions.scala:10-20,195-241`.
- Lookup dello stato logico per PA/NAV e dello stato del tentativo: `nodo4/src/main/scala/eu/sia/pagopa/common/repo/online/OnlineRepository.scala:3504-3518`.
- Attivazione: `nodo4/src/main/scala/eu/sia/pagopa/modello3/actor/ActivatePaymentNoticeBaseActor.scala:1062-1078`.
- `PAYMENT_RESERVED` nel close V2: `nodo4/src/main/scala/eu/sia/pagopa/modello1/ClosePaymentActorV2.scala:555-606`.
- Invio al PSP e mapping degli esiti: `nodo4/src/main/scala/eu/sia/pagopa/common/util/PspNotifyPaymentUtil.scala:74-79,123-168,282-352`.
- Cancellazione asincrona NMU: `nodo4/src/main/scala/eu/sia/pagopa/rtpull/actor/Mod3CancelV2Actor.scala:151-165`.
- Esito positivo V2: `nodo4/src/main/scala/eu/sia/pagopa/rptinvia/actor/SendPaymentOutcomeV2Actor.scala:185-211` e `nodo4/src/main/scala/eu/sia/pagopa/rptinvia/actor/SendPaymentOutcomeUtils.scala:254-272,1197-1239`.
- Invio, retry e stati dei destinatari ricevuta: `nodo4/src/main/scala/eu/sia/pagopa/common/util/ReceiptUtil.scala:568-644,675-695`.
- Aggiornamento snapshot e storico: `nodo4/src/main/scala/eu/sia/pagopa/common/repo/online/OnlineRepository.scala:2627-2652`; mapping tabelle in `nodo4/src/main/scala/eu/sia/pagopa/common/repo/online/table/PaymentPositionsTable.scala:433-488`.
- Session ID REST: `nodo4/src/main/scala/eu/sia/pagopa/common/util/web/NodoRoute.scala:111-118,550-562`.
- Eventi: `nodo4/src/main/scala/eu/sia/pagopa/common/json/model/TransactionEvent.scala:58-72,125-139` e `nodo4/src/main/scala/eu/sia/pagopa/common/util/azurehubevent/sdkazureclient/AzureProducerBuilder.scala:107-150,171-187`.
- Endpoint Prometheus e job: `nodo4/src/main/scala/eu/sia/pagopa/Main.scala:133-164,385-395`.
