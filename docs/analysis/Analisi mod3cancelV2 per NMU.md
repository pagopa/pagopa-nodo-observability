# Analisi mod3cancelV2 per NMU

Con l’introduzione del [Nuovo Modello Unico](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/522846291/A.T.+Nuovo+Processo+di+pagamento+attivato+presso+l+Ente+Creditore+NM1), è necessario prevedere una modifica al poller mod3CancelV2 per gestire l’annullo dei pagamenti multi-avviso. Non saranno necessarie modifiche al poller mod3CancelV1, che prende in esame pagamenti per PA-Old.

In particolare, nel caso in cui la primitiva pspNotifyPaymentV2 vada in timeout, e uno dei token scada prima dell’arrivo della sendPaymentOutcomeV2, tutti i token vanno annullati e va effettuata un’unica chiamata sendPayementResultV2 per tutti i token. Di conseguenza si decide di separare la gestione del mod3cancelV2 per lo stato PAYMENT\_UNKNOWN.

Vengono presentate di seguito due opzioni:

1. opzione generica (*“tritasassi”*)
    1. PRO: non necessita di modifiche a DB
    2. CONTRO: tante query pesanti
2. opzione specifica (*“fioretto”*)
    1. PRO: poche query
    2. CONTRO: introduzione nuova tabella a DB (auto-svecchiante)

Necessaria sessione di test PRF per ricalibratura query a DB

## OPZIONE 1 - generica RIFIUTATA

- se CLOSE\_VERSION=v2 \>\> controllo se nella paginazione corrente ho altri token con lo stesso transaction\_id del token in esame:
    - NE HO TROVATI 5 IN TOT \>\> non ce ne sono altri, procedo all'annullo e alla generazione della SPRv2- (togliendo tutti e cinque i token dalla paginazione)
    - NE HO TROVATI \<5 IN TOT \>\> cerco in un intorno temporale del token in esame per cercarne altri, anche se potrebbero non essercene. Con quelli trovati, procedo all'annullo e all'invio della SPRv2-.

Gli update devono essere eseguiti in una sola commit e con la where\_condition sullo stato (per evitare concorrenze con la SPO)

- se CLOSE\_VERSION=v1 \>\> annullo e mando SPRv1-

---

###  Impatti sul poller mod3CancelV2 attuale

- Rimozione dello stato PAYMENT\_UNKNOWN da quelli presi in considerazione


## Opzione 2 - specifica ACCETTATA

Nel flusso closePaymentV2, quando il Nodo modifica lo stato di uno o più payment in PAYMENT\_UNKNOWN a seguito del timeout / errore response della primitiva pspNotifyPayment (solo nel caso PA NEW) o pspNotifyPaymentV2, aggiunge un record in una apposita tabella di appoggio NMU\_CANCEL\_UTILITY:

| **CAMPO** | **TYPE** | **DESCRIZIONE** |
| --- | --- | --- |
| TRANSACTION\_ID | VARCHAR2(255) | Identificativo ricevuto nella closePaymentV2 |
| PAYMENT\_TOKENS | VARCHAR2(255) | I token identificativi dei pagamenti in corso, separati da virgola |
| NUM\_TOKEN | NUMBER | Il numero di token correlati nella transazione |
| VALID\_TO | TIMESTAMP | La scadenza dei token |
| INSERTED\_TIMESTAMP | TIMESTAMP | Timestamp di inserimento record |
| INSERTED\_BY | VARCHAR2(100) | Attore responsabile dell’inserimento |

| **CAMPO** | **VALORE** |
| --- | --- |
| TRANSACTION\_ID | closePaymentV2REQ.transactionId |
| PAYMENT\_TOKENS | closePaymentV2REQ.paymentTokens\[\] |
| NUM\_TOKEN | Ricavato da closePaymentV2REQ.paymentTokens\[\] |
| VALID\_TO | Calcolato in seguito alla closePaymentV2, corrisponde a POSITION\_ACTIVATE.TOKEN\_VALID\_TO |
| INSERTED\_TIMESTAMP | Timestamp corrente |
| INSERTED\_BY | closePayment-v2 |


La tabella viene svecchiata all’accettazione di una sendPaymentOutcome / sendPaymentOutcomeV2 (per token in stato PAYMENT\_UNKNOWN con POSITION\_PAYMENT.CLOSE\_VERSION='v2'), o dopo la gestione dell’annullo da parte del poller mod3CancelV2.

Il poller mod3CancelV2 estrae dalla tabella i record con VALID\_TO antecedente allo start del poller ed effettua le seguenti operazioni per ogni record:

1. verifica che lo stato di tutti i payment sia ancora in PAYMENT\_UNKNOWN sulla POSITION\_PAYMENT\_STATUS\_SNAPSHOT. In caso negativo:
    1. se tutti i token sono in uno stato diverso, cancella il record dalla tabella.
    2. se solo alcuni token sono in uno stato diverso, ignora il record e prosegue con il successivo.
2. effettua l’annullo dei token, tutti in un’unica commit:
    1. aggiorna lo stato del corrispettivo payment in CANCELLED
    2. aggiorna lo stato della corrispettiva posizione debitoria in INSERTED
3. elimina il record dalla tabella
4. procede alla generazione e all'invio della request [sendPaymentResultV2](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/511770849/Analisi+sendPaymentResultV2+Nodo-+PM).


---

###  Impatti sul poller mod3CancelV2 attuale

- Rimozione dello stato PAYMENT\_UNKNOWN con CLOSE\_VERSION='v2' da quelli presi in considerazione
