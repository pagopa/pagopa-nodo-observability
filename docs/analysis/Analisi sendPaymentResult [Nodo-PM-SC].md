# Analisi sendPaymentResult \[Nodo\-\>PM/SC\]

[sendPaymentResult](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/510493042/sendPaymentResult)

[A.T. Pagamenti con BPAY su AppIO](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/473563741/A.T.+Pagamenti+con+BPAY+su+AppIO)

Il Nodo comunica al Payment Manager l’esito del pagamento lato PSP tramite la primitiva sendPaymentResult-v1, utilizzando il token di pagamento come identificativo della transazione.

## Input

Per i servizi esposti su APIM deve essere utilizzata una sub-key da passare come header. Vd [\[WIP\] A.T. Nuova connettività: aggiunta subkey](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/712802680/WIP+A.T.+Nuova+connettivit+aggiunta+subkey)

1. paymentTokens\[\]
2. pspTransactionId
3. outcome

## Output

1. esito


## Diagramma UML

### 

### nodo genera request sendPaymentResult

Il Nodo genera la request della primitiva nei seguenti casi:

- dopo aver ricevuto una chiamata pspNotifyPayment con esito OK dal PSP;
- dopo aver ricevuto una chiamata closePayment con outcome OK a token scaduto dal PM;
- dopo aver ricevuto una response KO alla chiamata pspNotifyPayment dal PSP;
- alla scadenza del token nel caso di response sconosciuta alla chiamata pspNotifyPayment;
- dopo aver ricevuto una chiamata sendPaymentOutcome con outcome OK dal PSP nel caso di response sconosciuta alla chiamata pspNotifyPayment;

Tutti i casi sopracitati si riferiscono al [flusso di pagamento BPAY](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/473563741/A.T.+Pagamenti+con+BPAY+su+AppIO).

La request va popolata nel seguente modo:

| **CAMPO** | **VALORE** |
| --- | --- |
| 1. paymentTokens\[0\] 2. pspTransactionId 3. outcome | 1. POSITION\_PAYMENT.PAYMENT\_TOKEN 2. PM\_SESSION\_DATA.ID\_TRANSAZIONE\_PSP\_BPAY 3. **Vedi seguito** |

L’outcome dipende dall’evento che ha triggerato la chiamata:

- “outcome”: “**OK**”, nei seguenti casi
    - response pspNotifyPayment OK dal PSP (payment in stato PAYMENT\_SENT);
    - response pspNotifyPayment unknown (payment in stato PAYMENT\_UNKNOWN) e ricezione request sendPaymentOutcome OK dal PSP prima della scadenza del token;
- “outcome”: “**KO**”, nei seguenti casi
    - response pspNotifyPayment KO dal PSP (payment in stato PAYMENT\_SENT);
    - PSP non raggiungibile su pspNotifyPayment (payment in stato PAYMENT\_SEND\_ERROR);
    - response pspNotifyPayment unknown (payment in stato PAYMENT\_UNKNOWN) e scadenza del payment token (mod3Cancel);
    - request closePayment OK a token scaduto (payment in stato CANCELLED) (la request closePayment KO a token scaduto non scatena la sendPaymentRequest);

### UPDATE a DB nel caso di result KO

`POSITION_PAYMENT_STATUS/SNAPSHOT`

| **STATO DA** | **STATO A** |
| --- | --- |
| PAYMENT\_REFUSED | CANCELLED |
| PAYMENT\_SEND\_ERROR | CANCELLED |

`POSITION_STATUS/SNAPSHOT`

| **STATO DA** | **STATO A** |
| --- | --- |
| PAYING | INSERTED |


### INSERT/UPDATE su POSITION\_RETRY\_SENDPAYMENTRESULT

| **CAMPO** | **TYPE** |
| --- | --- |
| ID | Staccato dal Nodo |
| PAYMENT\_TOKEN | REQ.paymentTokens\[0\] |
| ~~ID\_DOMINIO~~ | ~~POSITION\_PAYMENT.PA\_FISCAL\_CODE~~ |
| ~~IUV~~ | ~~POSITION\_PAYMENT.CREDITOR\_REFERENCE\_ID~~ |
| ~~CCP~~ | ~~POSITION\_PAYMENT.~~ |
| ~~NOTICE\_ID~~ | ~~POSITION\_PAYMENT.NOTICE\_ID~~ |
| ~~CREDITOR\_REFERENCE\_ID~~ | ~~POSITION\_PAYMENT.CREDITOR\_REFERENCE\_ID~~ |
| PSP\_TRANSACTION\_ID | REQ.pspTransactionId |
| ~~PSP\_ID~~ | ~~POSITION\_PAYMENT.PSP\_ID~~ |
| ~~STAZIONE~~ | ~~POSITION\_PAYMENT.STATION\_ID~~ |
| ~~CANALE~~ | ~~POSITION\_PAYMENT.CHANNEL\_ID~~ |
| ID\_SESSIONE\_ORIGINALE | POSITION\_PAYMENT. |
| ~~OUTCOME~~ | ~~REQ.outcome~~ |
| RETRY | Numero di tentativi di retry effettuati per il pagamento in questione |
| REQUEST | CLOB che contiene la request REST formato JSON |
| INSERTED\_TIMESTAMP | Timestamp di creazione del record in tabella |
| UPDATED\_TIMESTAMP | Timestamp di aggiornamento del record in tabella |
| INSERTED\_BY | Business process responsabile della creazione del record in tabella |
| UPDATED\_BY | Business process responsabile dell'aggiornamento del record in tabella |
