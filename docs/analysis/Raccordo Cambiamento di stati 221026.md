# Raccordo del documento «Cambiamento di stati» con specifiche e implementazione

Analisi del 22 ottobre 2026.

**Aggiornamento implementativo 23 ottobre:** il design approvato separa storia
osservata e percorsi per fasi, mantiene la posizione distinta dai token e
riallinea destinatari in REST/SSE, aggregati e mock. D-01, D-03, D-05 e D-06
sono requisiti di questa consegna; le descrizioni «Oggi» sotto conservano la
rilevazione precedente, non lo stato dei nuovi file. D-02 resta un gate Nodo
aperto: il percorso PDF è indicato come applicabilità da confermare, senza
estensione generale degli archi. D-04 non autorizza nuovi alias o inferenze.
I test mock non verificano il consumer Event Hubs reale né eventi in produzione.

**Fonte:** [Cambiamento di stati-221026-152110.pdf](Cambiamento%20di%20stati-221026-152110.pdf), 4 pagine.

## Esito e limiti della verifica

Il documento conferma la separazione fra `Payment` (tentativo, chiave `paymentToken`) e `Position` (pagamento logico, chiave PA/NAV), il ramo close/notifica PSP, l'outcome diretto e la distinzione fra pagamento e consegna della ricevuta. Non introduce nuovi valori di stato rispetto agli enum già documentati.

Le novità più rilevanti riguardano `NOTICE_STORED`: il PDF descrive l'archiviazione durante `sendPaymentOutcome` in presenza di RPT, un successivo invio dal tentativo in quello stato e la permanenza della posizione in `NOTICE_STORED` anche dopo la risposta PA. L'implementazione copre solo parte di questo percorso.

Il confronto riguarda i file locali di specifica, Angular, mock REST/SSE e OpenAPI. **Non è una nuova verifica del codice Scala del Nodo né una certificazione degli eventi effettivamente emessi in produzione.** I riferimenti Scala presenti nella FSM restano evidenze documentali pregresse. Il mock non implementa il consumer Event Hubs: una transizione simulabile non dimostra che acquisizione, correlazione e inferenza siano implementate.

## 1. Lettura del PDF per entità

| Entità / fase | Indicazione del PDF | Raccordo |
| --- | --- | --- |
| `Payment`, pp. 1–2 | Tentativo identificato dal token; attivazione, close, notifica PSP, outcome e ricevuta | Corrisponde a `Attempt`, non a `Payment` del frontend, che rappresenta il pagamento logico |
| `Position`, pp. 2–4 | Posizione identificata da numero avviso e codice fiscale EC | Corrisponde a `Payment` / stato logico della console |
| RPT e RT, p. 4 | Sono presenti soltanto i titoli delle sezioni | Non sono specificate FSM complete; non è possibile ricavarne nuovi enum o un nuovo perimetro UI |
| Destinatario ricevuta, pp. 2 e 4 | Risposta valida del singolo destinatario e completamento di tutti i destinatari sono condizioni diverse | Il PDF non contiene un diagramma dedicato del destinatario; resta necessario quello locale a 4 stati |

Il nodo grafico `PAYING / PAYING_RPT` raggruppa due stati per leggibilità: **non autorizza a fonderli** né dimostra che `activatePaymentNotice` produca entrambi. Analogamente, i nodi Mermaid `join` sono raccordi grafici, non stati persistiti o prova di eventi aggiuntivi.

## 2. Aspetti già coerenti

| Aspetto | Evidenza locale | Valutazione |
| --- | --- | --- |
| 5 stati logici, 18 del tentativo, 4 del destinatario | `src/app/models/domain.ts:1–13`; FSM, «Stati persistiti» | Il PDF non richiede di ampliare gli enum; il suo diagramma non è esaustivo dei rami legacy |
| `PAYING → PAYMENT_RESERVED → PAYMENT_SENT`, poi accettato/rifiutato/unknown/errore | `domain.ts:237–246`; `mocks/scenarios.mjs:8–40` | Coerente con pp. 1–2 |
| `PAYMENT_ACCEPTED` non equivale a `PAID` | `mocks/scenarios.mjs:32–35`; FSM, precisazioni sul flusso | Serve il successivo outcome positivo |
| `PAYMENT_UNKNOWN → PAID` oppure `CANCELLED` | `domain.ts:245`; scenari `outcomeOk`, `expireUnknown` | Coerente; restano le condizioni di gruppo/annullabilità gestite dal Nodo |
| KO outcome diretto distinto dal KO della notifica PSP | Scenari `nm3OutcomeKo` e `resultKo`; analisi outcome V2, «Check stato payment» | `FAILED` e `CANCELLED` non sono sinonimi; il KO non va esteso a NM1/appIO |
| Ritorno della posizione a `INSERTED` dopo annullo/KO ammesso | `mocks/scenarios.mjs:5–15,36–40` | Non serve uno stato logico `CANCELLED` |
| Posizione iniziale anche direttamente `PAYING` | Fixture in `mocks/model.mjs:14–57`; FSM §1 | Non va inferito sempre un precedente `INSERTED` |
| Posizione e tentativo non notificati necessariamente insieme | Scenari `primaryResponse`, `completeReceipt`; `mocks/test/scenarios.test.mjs:97–121` | Il mock distingue risposta PA intestataria e completamento di tutti i destinatari |
| `NOTIFIED` non prova outcome applicativo PA OK | FSM §3; `Analisi paSendRTV2.md`, update destinatario | Il testo a p. 4 conferma esplicitamente che non è richiesto `outcome=OK` |

La categoria visuale `ok` per `PAYMENT_ACCEPTED` e `NOTIFIED` (`domain.ts:192–200`) non costituisce un campo di esito finanziario/applicativo. Va mantenuta questa distinzione anche nei testi e nelle metriche.

## 3. Divergenze e integrazioni necessarie

### D-01 — Archiviazione durante l'outcome, non soltanto all'arrivo tardivo della RPT

**PDF:** p. 2, diagramma Payment, righe Mermaid 46–47; p. 3, diagramma Position, righe 33–34 e testo finale. In presenza di RPT, `sendPaymentOutcome` può generare e archiviare la ricevuta nella stessa elaborazione, prima della risposta al PSP:

- tentativo: `PAID → NOTICE_GENERATED → NOTICE_STORED`;
- posizione: `PAYING → PAID → NOTICE_STORED`.

Il PDF distingue questo caso dalla RPT tardiva per un pagamento `PAID_NORPT`.

**Oggi:** gli archi UI già consentono `NOTICE_GENERATED → NOTICE_STORED` e posizione `PAID → NOTICE_STORED` (`domain.ts:229–250`). Tuttavia, la tabella dei trigger della FSM e il catalogo mock associano l'archiviazione a `NodoInviaRPT`; `legacyStoreReceipt` è l'unico scenario di archiviazione (`mocks/scenarios.mjs:68–71`). La copertura del ramo durante l'outcome manca.

**Raccordo:** aggiungere alla mappatura documentale anche il trigger outcome nel ramo con RPT, senza sostituire il completamento tardivo. Non inferire `NOTICE_STORED` dalla sola generazione della ricevuta: serve evidenza del percorso o l'evento di stato. Non introdurre payload/RPT nel modello di consultazione per risolvere questa distinzione.

### D-02 — Invio dal tentativo `NOTICE_STORED`: incompatibilità reale fra i grafi

**PDF:** p. 2, righe Mermaid 49–52: sia `NOTICE_GENERATED` sia `NOTICE_STORED` confluiscono nell'invio `paSendRT` verso `NOTICE_SENT`.

**Oggi:** `ATTEMPT_FSM_ARCS` non ha un'uscita da `NOTICE_STORED`; la UI lo considera terminale e un test lo richiede esplicitamente (`src/app/models/domain.spec.ts:61–70`). Lo scenario `sendReceipt` ammette solo il tentativo `NOTICE_GENERATED` e la posizione `PAID` (`mocks/scenarios.mjs:46–48`). La FSM locale descrive inoltre `NOTICE_STORED` come ricevuta conservata e non inviata come receipt.

**Impatto:** dopo l'archiviazione la progressione UI non presenta `NOTICE_SENT`/`NOTIFIED` come raggiungibili. Il mock non consente di esercitare il percorso del PDF.

**Da confermare prima di cambiare comportamento:** se il successivo invio è effettivamente ammesso per tutti i casi `NOTICE_STORED` o solo per alcuni rami/versioni. In quest'ultimo caso serve una regola di percorso, non un'estensione indiscriminata del grafo. Il solo stato non distingue necessariamente archiviazione con invio successivo e conservazione legacy.

### D-03 — La posizione `NOTICE_STORED` non deve essere promossa a `NOTIFIED`

**PDF:** p. 4: l'aggiornamento della posizione a `NOTIFIED` avviene solo se è ancora `PAID`, alle condizioni del destinatario. Se è già `NOTICE_STORED`, resta in quello stato; destinatario e tentativo possono invece progredire.

**Oggi:** il grafo logico è già compatibile: `PAID → {NOTICE_STORED, NOTIFIED}`, senza uscita da `NOTICE_STORED` (`domain.ts:229–235`). Manca però uno scenario che combini posizione archiviata e avanzamento della consegna. `completeReceipt` imposta sempre anche la posizione a `NOTIFIED`, sebbene le sue precondizioni attuali impediscano di partire da `NOTICE_STORED` (`mocks/scenarios.mjs:49–55`).

**Raccordo:** rendere esplicita la guardia nella specifica e coprire il caso nel mock prima di estendere gli invii. Non aggiungere `NOTICE_STORED → NOTIFIED` alla posizione per rendere simmetriche le due FSM. Nella pipeline reale i tre prefissi RE aggiornano le rispettive entità, non si deriva la posizione dallo stato del tentativo.

### D-04 — Trigger legacy aggiuntivi della posizione

**PDF:** p. 3: inserimento iniziale tramite `nodoInviaRPT`; `PAYING → PAID` con `nodoInviaRT` o job `pspChiediListaAndChiediRT` con RT OK; ritorno a `INSERTED` con RT KO; annullo con `mod3CancelV1/V2` quando ammesso.

**Oggi:** gli stati e gli archi logici esistono, ma questi trigger non sono coperti integralmente dalla tabella «Transizioni per primitiva» o dal catalogo mock. Il PDF non specifica le corrispondenti transizioni complete del tentativo.

**Raccordo:** ampliare l'inventario dei trigger della posizione distinguendo inserimento, RT sincrona e recupero via job. Verificare campioni RE/versione Nodo prima di stabilire alias, precondizioni o inferenze. Non usare il nome della primitiva per inventare una transizione del tentativo o acquisire payload RT/RPT.

### D-05 — Destinatari: decisione documentata e frontend presenti, contratto e mock incompleti

Questa divergenza è **preesistente**, non una nuova richiesta del PDF.

La FSM e la specifica backend §7.1/AC-06 riportano la decisione del 22 ottobre di proiettare `receipt_recipient_*` come terza entità. Angular contiene `Recipient`, `Payment.recipients`, progressione, sezione dettaglio, aggregati e delta destinatari (`domain.ts:65–87,109–119`; `payment-reducer.ts:12–29,76–105`; template dettaglio, sezione «Destinatari ricevuta»).

Invece:

- `mocks/model.mjs:116–119` restituisce il dettaglio senza `recipients`; l'aggregazione considera solo posizione e tentativo;
- OpenAPI `PaymentDetail` non definisce `recipients` e vieta proprietà aggiuntive (`docs/api/openapi.json:1640–1708`); non è presente uno schema `Recipient`;
- il test mock del ramo ricevuta richiede ancora l'assenza di destinatari dal delta (`mocks/test/scenarios.test.mjs:114`);
- la specifica di piattaforma §1–4 e la guida mock, «Indicazioni per il backend reale», mantengono passaggi che escludono i destinatari, in contrasto con la decisione più recente.

Una verifica locale delle funzioni mock e dello schema conferma l'assenza di `recipients`, `recipientStates` e `matrices.recipient`. Non è solo una mancanza di fixture: Angular legge `item.recipients.length` nel template e `recipientStates.map` in `maxRecipients()`, mentre `ObservabilityApi.payment()`/`overview()` restituiscono direttamente la risposta HTTP senza mapping (`observability-api.service.ts:56–61`). Il tipo TypeScript non aggiunge i campi mancanti: questi accessi possono fallire con le risposte mock attuali.

**Raccordo:** applicare coerentemente la decisione già registrata a specifica di piattaforma, OpenAPI, REST, SSE, mock, retention e test, non aggiungere soltanto array vuoti al client per mascherare il disallineamento. Il PDF non definisce identità e retention del destinatario: su questi punti non sostituisce le decisioni locali.

### D-06 — Terminologia e provenienza

`NOTICE_STORED` è etichettato «Avviso memorizzato» in `domain.ts:174`, mentre il PDF parla di ricevuta archiviata. È una revisione di etichetta da coordinare con `Analisi paymentStatus.md`, non una rinomina dello stato originale.

Il testo del PDF usa anche `CANCELED`, ma il diagramma e gli enum usano `CANCELLED`: non introdurre un nuovo stato o un alias RE per il refuso.

`paSendRT` è la causa applicativa della consegna, ma non sostituisce automaticamente il `tipoEvento` sorgente. I campioni citati da `Analisi status RE.md:45` riportano anche `sendPaymentOutcomeV2` per stati della ricevuta; i trigger delle fixture non sono quindi da correggere in blocco in `paSendRTV2`.

## 4. Regole da preservare nel raccordo

1. Accettazione PSP, pagamento acquisito, archiviazione e notifica sono fasi distinte. Non ricavare l'esito applicativo PA dal colore o da `NOTIFIED`.
2. Un diagramma sintetico non elimina `*_NORPT`, condizioni NM3/NM1/appIO, varianti PA OLD o percorsi stand-in già documentati. Il PDF non risolve gli ingressi di `PAYING_RPT` e `CANCELLED_NORPT`.
3. `PAYMENT_SEND_ERROR → CANCELLED` nel PDF supporta la lettura di stato intermedio della FSM. Non basta a cambiare la policy visuale corrente o il contratto esterno di `paymentStatus`, che lo classifica KO.
4. Né una chiamata di interfaccia né la sola scadenza locale autorizzano la console a cambiare stato. Restano necessari eventi di cambio stato ammessi, con chiavi e prefisso della corretta entità.
5. La progressione Angular calcola la raggiungibilità, ma restituisce gli stati nell'ordine degli enum (`domain.ts:263–286`); i connettori del template non costituiscono un diagramma degli archi del PDF. La sequenza delle transizioni resta la fonte per la storia, inclusi ritorni a `INSERTED` e retry.
6. Nessuna inferenza automatica di `PAYMENT_ACCEPTED` prima di `PAID`, di `INSERTED` prima di `PAYING` o di tutti gli stati della ricevuta prima di `NOTIFIED` quando il percorso non è univoco.

## 5. Priorità di riallineamento e casi di accettazione

| Priorità | Intervento | Risultato da verificare |
| --- | --- | --- |
| Alta | Completare il contratto destinatari già approvato (D-05) | Snapshot REST e delta SSE compatibili con i modelli UI; destinatari separati, timeout/retry visibili, aggregati e retention coerenti; nessuna eccezione per campi mancanti |
| Alta | Confermare il ramo di invio da `NOTICE_STORED` (D-02) | Evidenza Nodo/RE del percorso; se ammesso, progressione e mock permettono `NOTICE_STORED → NOTICE_SENT → NOTIFIED` sul solo tentativo |
| Alta | Coprire la guardia della posizione archiviata (D-03) | Dopo risposta PA valida, anche applicativamente KO, posizione ancora `NOTICE_STORED`; nessun `position_NOTIFIED` sintetizzato |
| Media | Aggiungere archiviazione durante outcome con RPT (D-01) | Distinzione fra archiviazione contestuale e RPT tardiva; trigger e timestamp conservati senza inventare stati mancanti |
| Media | Completare inventario dei trigger legacy (D-04) | Inserimento iniziale e RT OK/KO tracciati sulla posizione; nessuna transizione del tentativo dedotta senza evidenza |
| Bassa | Coordinare etichetta e spiegazioni UI (D-06) | Valori originali invariati; archiviazione non confusa con consegna e `NOTIFIED` non descritto come outcome PA OK |

Questa revisione aggiorna il raccordo documentale, **non modifica codice, contratto o scenari**. Le differenze che richiedono riscontro del Nodo restano esplicite; non sono risolte scegliendo implicitamente il PDF contro le analisi precedenti.
