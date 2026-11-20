# Analisi status RE

Questa analisi descrive le famiglie di cambio stato pubblicate sul Registro Eventi. 
Le liste iniziali sotto sono mantenute come materiale di analisi, **non come contratto esaustivo degli enum o delle transizioni**. 
Il confronto con le altre analisi e con i riferimenti al codice già raccolti è riportato al §4; per stati e trigger consolidati fare riferimento a `docs/spec/FSM stati di pagamento.md`.

## 1. Prefisso position_* (FSM della Posizione Debitoria)

Il prefisso position_* traccia lo stato complessivo della posizione debitoria dell'Ente Creditore nel ciclo di vita NM3. Corrisponde alle tabelle del DB online POSITION_STATUS_SNAPSHOT e POSITION_STATUS
I principali cambi stato valorizzati su RE per questa famiglia includono:
- position_INSERTED: La posizione debitoria è stata inserita o riaperta (es. a seguito dell'annullamento di un precedente tentativo di pagamento fallito o scaduto)
- position_PAYING: La posizione è bloccata poiché è stato avviato ed è in corso un tentativo di pagamento da parte di un utente/PSP
- position_PAID: La posizione debitoria è stata saldata con successo (a seguito dell'esito positivo del pagamento)
- position_NOTIFIED: La ricevuta (Receipt/RT) è stata consegnata ed accettata con successo dall'Ente Creditore intestatario
- position_NOTICE_STORED: La ricevuta è stata memorizzata sulla piattaforma a disposizione per la successiva consultazione della PA
- position_CANCELLED: La posizione o la relativa sessione è stata annullata

## 2. Prefisso payment_* (FSM del Tentativo di Pagamento / Token)

Il prefisso payment_* traccia l'evoluzione del singolo tentativo di pagamento associato ad uno specifico paymentToken.
Corrisponde alle tabelle POSITION_PAYMENT_STATUS_SNAPSHOT e POSITION_PAYMENT_STATUS.
I principali cambi stato valorizzati su RE per questa famiglia includono:
- payment_PAYING: Il tentativo di pagamento è stato creato ed è in fase di elaborazione (es. generato all'arrivo della activatePaymentNotice)
- payment_PAYMENT_RESERVED: L'importo del pagamento è stato prenotato a seguito della chiamata closePayment con esito positivo (OK), in attesa dell'invio della notifica al PSP
- payment_CANCELLED: Il tentativo di pagamento è stato annullato (ad esempio a seguito di una closePayment con esito negativo KO, per scadenza del token o per azione dei job di annullamento)
- payment_SENT: La notifica di pagamento è stata inoltrata al PSP
- payment_ACCEPTED: Il pagamento è stato autorizzato ed eseguito con successo
- payment_REFUSED: Il pagamento è stato rifiutato dal PSP o dal gateway
- payment_SEND_ERROR: Si è verificato un errore di rete o di connessione durante la notifica al PSP
- payment_UNKNOWN: Esito incognito o timeout riscontrato durante l'interazione con il PSP

## 3. Prefisso receipt_recipient_* (FSM del Destinatario della Ricevuta)

Il prefisso receipt_recipient_* traccia lo stato dell'invio e notifica della ricevuta (Receipt/RT) ai singoli Enti Creditori destinatari.
Nel modello dati del Nodo, una singola ricevuta (tabella POSITION_RECEIPT) può avere uno o più destinatari (tabella POSITION_RECEIPT_RECIPIENT), ad esempio nei casi di pagamenti multibeneficiario in cui sono presenti una PA primaria e una o più PA secondarie.
Lo storico dei relativi cambi di stato viene registrato nella tabella POSITION_RECEIPT_RECIPIENT_STATUS.
Gli eventi tracciati su RE per questa famiglia comprendono:
- receipt_recipient_STATUS (o gli stati specifici di avanzamento dell'invio verso il destinatario): Traccia lo stato di inoltro della ricevuta allo specifico codice fiscale Ente Creditore destinatario (RECIPIENT_PA_FISCAL_CODE), della stazione (RECIPIENT_STATION_ID) e dell'eventuale intermediario secondario (RECIPIENT_BROKER_PA_ID)
- Permette di verificare in modo disaggregato se la ricevuta è stata inviata, accettata o se è in coda di retry per ciascuna PA beneficiaria coinvolta nel pagamento

## 4. Raccordo con la FSM e punti da verificare

**Esito della revisione:** le tre famiglie confermano la separazione tra posizione, tentativo e destinatario. Non costituiscono, da sole, evidenza di nuovi stati né di nuovi archi della FSM. Lo stato RE indica l'entità e lo stato raggiunto, non necessariamente la primitiva o la causa che lo ha prodotto.

Nei campioni locali `docs/analysis/re_messages.json`, `payment_NOTIFIED` e `receipt_recipient_NOTICE_SENT` riportano `tipoEvento = sendPaymentOutcomeV2`: il valore può descrivere il flusso applicativo che esegue gli aggiornamenti. Non va sostituito con `paSendRTV2` soltanto perché lo stato riguarda l'invio/conclusione della receipt; provenienza RE e causa applicativa vanno distinte.

| Voce delle liste iniziali | Riscontro nelle altre analisi / FSM | Trattamento |
| --- | --- | --- |
| `position_CANCELLED` | assente dai 5 stati di `PositionStatusEnum` documentati; close KO, result KO e annullo NMU producono tentativo `CANCELLED` e posizione `INSERTED` | discrepanza aperta: acquisire un evento reale e verificare versione/ramo Nodo prima di aggiungere uno stato o una transizione logica |
| `payment_SENT`, `payment_ACCEPTED`, `payment_REFUSED`, `payment_SEND_ERROR`, `payment_UNKNOWN` | l'enum del tentativo contiene `PAYMENT_SENT`, `PAYMENT_ACCEPTED`, `PAYMENT_REFUSED`, `PAYMENT_SEND_ERROR`, `PAYMENT_UNKNOWN` | con la regola prefisso + enum, i valori RE attesi sono `payment_PAYMENT_SENT`, `payment_PAYMENT_ACCEPTED`, `payment_PAYMENT_REFUSED`, `payment_PAYMENT_SEND_ERROR`, `payment_PAYMENT_UNKNOWN`; grafia da confermare su campioni, nessun alias automatico |
| Elenco degli stati `payment_*` | `Analisi paymentStatus.md` elenca 18 stati, compresi legacy e stati di ricevuta del tentativo | lista al §2 parziale, non sostituisce l'enum completo |
| `payment_ACCEPTED` come pagamento «eseguito con successo» | `PAYMENT_ACCEPTED` registra l'accettazione PSP; nel flusso close V2 si attende ancora `sendPaymentOutcome`/V2 per `PAID` | non equiparare accettazione PSP, pagamento concluso e ricevuta notificata |
| `position_NOTIFIED` come «accettata con successo» | `Analisi paSendRT.md` e `Analisi paSendRTV2.md`: una risposta intellegibile OK **o KO** porta a `NOTIFIED` | correggere la lettura semantica: risposta ricevuta, non successo applicativo garantito |
| `position_NOTICE_STORED` | i riferimenti legacy/RPT della FSM e `Analisi paymentStatus.md` distinguono conservazione da invio della receipt | non interpretare come prova di consegna PA o conseguenza automatica di ogni generazione receipt |
| `receipt_recipient_STATUS` | notazione generica; gli stati documentati sono `NOTICE_GENERATED`, `NOTICE_SENT`, `NOTICE_PENDING`, `NOTIFIED` | non creare uno stato letterale `STATUS`; il `NOTIFIED` di un destinatario non implica quello di tutti i destinatari o del tentativo |

I trigger da esplicitare nella documentazione, usando anche le analisi delle primitive, sono:

- **Attivazione V1/V2 e outcome diretto NM3:** il tentativo NM3 può andare da `PAYING` a `PAID`/`FAILED` con `sendPaymentOutcome` o `sendPaymentOutcomeV2` OK/KO; la posizione va rispettivamente a `PAID`/`INSERTED`, senza imporre il ramo close/notifica PSP.
- **Annulli close V1/V2:** oltre al KO esplicito, close V2 annulla i token conosciuti coinvolti nei casi di token sconosciuto/scaduto nel gruppo o PA OLD senza RPT. Non si crea un tentativo per un token sconosciuto.
- **Result V1/V2 e scadenza NMU:** distinguere il KO che annulla da un retry tecnico; `PAYMENT_UNKNOWN` può risolversi con outcome positivo o con annullo condizionato del gruppo da parte del Nodo.
- **Generazione e invio receipt V1/V2:** distinguere `NOTICE_GENERATED`, invio alla PA intestataria (`payment_NOTICE_SENT`), risposta di quella PA (`position_NOTIFIED`) e risposta di tutti i destinatari (`payment_NOTIFIED`); un timeout interessa `receipt_recipient_NOTICE_PENDING`.
- **Legacy/RPT e retry:** documentare i completamenti `*_NORPT`, `NOTICE_STORED` e il reinvio della receipt; l'ingresso in `PAYING_RPT`/`CANCELLED_NORPT` resta da verificare. Il solo retry `sendPaymentResult` non prova una nuova transizione di business.

Il dettaglio di tutte le coperture, delle condizioni e delle fonti è nella tabella «Transizioni per primitiva» e nella sezione «Copertura di tutti gli stati e trigger da completare» della FSM.

### Impatto sulla piattaforma di osservabilità

La decisione del 22 ottobre 2026 supera l'esclusione originaria: filtro `esito = CAMBIO_STATO` e prefisso `payment_`/`position_`/`receipt_recipient_`, con tre entità separate. Il destinatario è identificato da PA/NAV e `info.stazione_recipient`, non dal token. Stato, timeline, provenienza e revisione sono proiettati; payload e outcome applicativo PA restano esclusi. Non sono certificati legame al tentativo, ruolo intestatario o completezza dei destinatari: nessun conteggio notificati/attesi inferito dal client.

Rimuovere solo il prefisso di entità non autorizza a rinominare lo stato: `payment_PAYMENT_UNKNOWN` produce `PAYMENT_UNKNOWN`, mentre `payment_UNKNOWN` produrrebbe `UNKNOWN`, che non è nell'enum documentato. Valori o transizioni non riconosciuti richiedono diagnosi tecnica e riconciliazione, non conversioni silenziose, nuovi enum impliciti o assegnazioni a un'altra entità.

Prima di modificare il contratto sorgente servono campioni RE e riscontro della versione Nodo per `position_CANCELLED`, per le cinque grafie abbreviate e per gli stati intermedi/legacy non ancora campionati. Questa revisione non è una nuova verifica del codice Nodo né una conferma di eventi osservati in produzione.