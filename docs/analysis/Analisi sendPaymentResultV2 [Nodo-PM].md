# Analisi sendPaymentResultV2 \[Nodo\-\>PM\]

[A.T. Nuovo flusso unificato IO/Checkout](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/493585901/A.T.+Nuovo+flusso+unificato+IO+Checkout)

[A.T. \[Nuovo\] Processo di pagamento attivato presso l’Ente Creditore NM1](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/522846291/A.T.+Nuovo+Processo+di+pagamento+attivato+presso+l+Ente+Creditore+NM1)

Il Nodo comunica al Payment Manager l’esito del pagamento lato PSP tramite la primitiva sendPaymentResultV2, utilizzando i token di pagamento come identificativi della transazione.

## Input

Per i servizi esposti su APIM deve essere utilizzata una sub-key da passare come header. Vd [\[WIP\] A.T. Nuova connettività: aggiunta subkey](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/712802680/WIP+A.T.+Nuova+connettivit+aggiunta+subkey)

1. outcome
2. paymentDate
3. payments\[\] (da 1 a 5 elementi)
    1. paymentToken
    2. description
    3. creditorReferenceId
    4. fiscalCode
    5. companyName
    6. officeName
    7. debtor

## Output

1. outcome


## Diagramma UML


### nodo genera request sendPaymentResultV2

Il Nodo genera la request della primitiva nei seguenti casi:

- dopo aver ricevuto una response KO alle chiamate pspNotifyPayment/pspNotifyPaymentV2 per token con POSITION\_PAYMENT.CLOSE\_VERSION='v2';
- alla scadenza del token nel caso di response sconosciuta alle chiamate pspNotifyPayment/pspNotifyPaymentV2;
- a seguito delle chiamate sendPaymentOutcome/sendPaymentOutcomeV2 per token con POSITION\_PAYMENT.CLOSE\_VERSION='v2' e payment in stato PAYMENT\_ACCEPTED o PAYMENT\_UNKNOWN.

dopo aver ricevuto una chiamata closePaymentV2 con outcome OK a token scaduto dal PM, oppure con RPT annullata in precedenza, NON SI MANDA la sendPaymentResultV2.

In generale la response KO alla closePayment chiude il flusso di pagamento, NON ci deve essere nessuna sendPaymentResultV2 dopo.

I casi sopracitati si riferiscono al [flusso di pagamento IO/Checkout](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/493585901/A.T.+Nuovo+flusso+unificato+IO+Checkout) e [Nuovo Modello Unico](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/522846291/A.T.+Nuovo+Processo+di+pagamento+attivato+presso+l+Ente+Creditore+NM1).

### Dettaglio campi request

| **Campo** | **Valore** |
| --- | --- |
| outcome | **Vedi sotto** |
| paymentDate | POSITION\_PAYMENT{0}.INSERTED\_TIMESTAMP**Il timestamp del payment più vecchio presente in quella transazione.** Rappresenta l'istante temporale della response alla prima attivazione *getPayment/paaAttivaRPT* |
| payments.paymentToken | **Flusso IO/checkout**: POSITION\_PAYMENT.PAYMENT\_TOKEN**Flusso NMU**: ~~Ricavati dalla request o identificati dal batch mod3cancel~~mod3Cancel: i token che fanno parte della stessa transazione a cui appartiene quello annullatosendpaymentOutcomeV2: i token presenti nella requestclosePaymentV2: i token presenti nella request |
| payments.description | POSITION\_SERVICE.DESCRIPTION |
| payments.creditorReferenceId | POSITION\_PAYMENT.CREDITOR\_REFERENCE\_ID |
| payments.fiscalCode | POSITION\_PAYMENT.PA\_FISCAL\_CODE |
| payments.companyName | POSITION\_SERVICE.COMPANY\_NAME |
| payments.officeName | POSITION\_SERVICE.OFFICE\_NAME |
| payments.debtor | POSITION\_SUBJECT.ENTITY\_UNIQUE\_IDENTIFIER\_VALUEcon POSITION\_SUBJECT.ID=POSITION\_SERVICE.DEBTOR\_ID econ POSITION\_SUBJECT.SUBJECT\_TYPE='DEBTOR' |

L’informazione del `transactionId` è stata spostata dal body della request alla signature della chiamata, dove viene anche aggiunta l’eventuale queryString ricevuta nella closePaymentV2.REQ e memorizzata in PM\_METADATA con key='QUERYSTRING' legata al `transactionId` in corso di gestione.

`restapi-cd/v2/transactions/{idTransaction}/user-receipts[?<valore della chiave 'QUERYSTRING' ricavata da PM_METADATA>]`


L’outcome dipende dall’evento che ha triggerato la chiamata:

- “outcome”: “**OK**”, nei seguenti casi
    - ricezione SPO/SPOV2 con outcome OK e i payment in stato PAYMENT\_ACCEPTED o PAYMENT\_UNKNOWN
- “outcome”: “**KO**”, nei seguenti casi
    - response pspNotifyPayment/pspNotifyPaymentV2 KO dal PSP (payment in stato PAYMENT\_REFUSED);
    - PSP non raggiungibile su pspNotifyPayment/pspNotifyPaymentV2 (payment in stato PAYMENT\_SEND\_ERROR);
    - scadenza dei token per payment in stato PAYMENT\_UNKNOWN (mod3Cancel);

### UPDATE a DB nel caso di sendPaymentResultV2 KO

A seguito dell’invio di una request sendPaymentResultV2 KO, gli stati dei [payment ](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#Payment)e delle [posizioni ](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#Position)vengono modificati come segue:

`POSITION_PAYMENT_STATUS/SNAPSHOT`

| **STATO DA** | **STATO A** |
| --- | --- |
| PAYMENT\_REFUSED | CANCELLED |
| PAYMENT\_SEND\_ERROR | CANCELLED |

`POSITION_STATUS/SNAPSHOT`

| **STATO DA** | **STATO A** |
| --- | --- |
| PAYING | INSERTED |

### Response

La response alla sendPaymentResultV2 è puramente informativa e implica solo la accettata notifica dell’esito del pagamento lato PM.

- Response 200

Nel caso di response OK, il PM notifica la buona riuscita della chiamata.

```
{"esito": "OK"}
```

Nel caso in cui si verifichi un’eccezione nell’update del pagamento lato PM, questo può rispondere con HTTP status 200 ed esito KO, ma in questo caso non viene effettuato un retry lato Nodo.

- Error response

I possibili stati HTTP emessi dal PM in caso di errore sono i seguenti:

| **HTTP STATUS CODE** | **CONTENT** |
| --- | --- |
| 400 | BAD REQUEST |
| 404 | NOT FOUND |
| 408 | TIMEOUT |
| 422 | UNPROCESSABLE ENTITY |

In questi casi il pagamento viene inserito in una coda di retry.

### Gestione retry

Il Nodo si assume la responsabilità di tenere traccia se l’esito per il pagamento identificato dal transaction\_id in questione sia già stato inoltrato al PM, e se l’esito sia OK o KO. Nel caso in cui una chiamata sendPaymentResultV2 ottenga httpResponseCode diverso da 200, il Nodo prende in carico il retry fino ad un numero massimo di tentativi (customizzabile da chiave di configurazione scheduler.sendPaymentResultPollerMaxRetry) o fino alla ricezione di una response 200.

A questo scopo è presente la tabella NODO\_ONLINE.**POSITION\_RETRY\_SENDPAYMENTRESULT** .

Nel caso in cui la chiamata ottenga httpResponseCode diverso da 200, il Nodo crea un record in tabella con valore “RETRY”=0. Per ogni tentativo successivo, il valore viene incrementato fino al raggiungimento del valore massimo. Se uno dei retry ottiene la response OK, il ciclo di retry si ferma e il record in tabella deve essere eliminato (auto-svecchiamento). Il record rimane in tabella solo se tutti i retry disponibili vanno in KO. A questo punto sarà possibile azzerare manualmente da Web-BO il contatore per far ripartire il ciclo.

Il cron job gira ogni due minuti ed effettua la chiamata per tutti i pagamenti presenti in tabella che non abbiano ancora raggiunto la soglia massima di tentativi.

**La tabella di retry contiene**

ID (sequence)

PAYMENT\_TOKEN (valorizzato sui flussi con token unico Appio/Checkout)

PSP\_TRANSACTION\_ID (valorizzato sul flusso multi-avviso NMU)

REQUEST (CLOB che contiene la request REST formato JSON)

RETRY (contattore del numero di retry)

ID\_SESSIONE\_ORIGINALE (contiene ID\_SESSIONE della RPT caso PA OLD/TRANSACTION\_ID caso PA NEW)

INSERTED\_TIMESTAMP/UPDATED\_TIMESTAMP

INSERTED\_BY/UPDATED\_BY

**Indicizzazione su Kibana**

si inseriscono sull’applicativo dedicato il valore PAYMENT\_TOKEN e TRANSACTION\_ID in riferimento alla chiamata.

~~Nel caso di pagamenti multi-avviso, nei campi ID\_DOMINIO, NOTICE\_ID, IUV, CREDITOR\_REFERENCE\_ID, CCP, PAYMENT\_TOKEN,STAZIONE della tabella vengono popolati con la concatenazione dei dati relativi a tutti i pagamenti, separati da virgole.~~

Lato web-BO va inserito il meccanismo di trigger per il reset del numero di retry della tabella POSITION\_RETRY\_SENDPAYMENTRESULT. Vedi [Web-BO: coda sendPaymentResult](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/481034918)

### Salvataggio log su Registro Eventi (WIP)

Per la chiamata sendPaymentResultV2 è previsto il salvataggio dei seguenti log su RE:

- log di request e response, secondo la modalità già presente per le altre primitive, anche per tutte le chiamate di retry;
- log dei eventuali cambi di stato:
    - payment\_CANCELLED
    - position\_INSERTED

I campi riportati nella tabella seguente sono mandatori. Le informazioni assenti in request vanno recuperate tramite JOIN POSITION\_PAYMENT pp ON pp.PAYMENT\_TOKEN=REQ.paymentTokens\[0\].

| **CAMPI OBBLIGATORI** | **VALORE REQ/RESP** | **VALORE CAMBIO STATO** |
| --- | --- | --- |
| IDENTIFICATIVO\_DOMINIO | pp.PA\_FISCAL\_CODE | pp.PA\_FISCAL\_CODE |
| IDENTIFICATIVO\_UNIVOCO\_VERSAMENTO | pp.CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID |
| CODICE\_CONTESTO\_PAGAMENTO | REQ.paymentTokens\[0\] | REQ.paymentTokens\[n\] |
| IDENTIFICATIVO\_PRESTATORE\_SERVIZI\_PAGAMENTO | pp.PSP\_ID | pp.PSP\_ID |
| COMPONENTE | **FESP** | **FESP** |
| CATEGORIA\_EVENTO | **INTERFACCIA** | **INTERNO** |
| TIPO\_EVENTO | **sendPaymentResult-v2** | **sendPaymentResult-v2** |
| SOTTO\_TIPO\_EVENTO | **REQ/RESP** | **INTERN** |
| INFO | L'URL della chiamata(contiene quindi il transaction\_id e l’eventuale queryString, esempio <http://172.31.251.182:9087/v2/sendpaymentresult/24115460?clientId=eCommerce>) | pp.TRANSACTION\_ID |
| IDENTIFICATIVO\_STAZIONE\_INTERMEDIARIO\_PA | pp.STATION\_ID | pp.STATION\_ID |
| CANALE\_PAGAMENTO | pp.CHANNEL\_ID | pp.CHANNEL\_ID |
| BUSINESS\_PROCESS | **sendPaymentResult-v2** | **sendPaymentResult-v2** |
| NOTICE\_ID | pp.NOTICE\_ID | pp.NOTICE\_ID |
| CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID |
| PAYMENT\_TOKEN | REQ.paymentTokens\[0\] | REQ.paymentTokens\[n\] |
| ID\_SESSIONE\_ORIGINALE | - PA OLD: ID\_SESSIONE della RPT - PA NEW: pp.TRANSACTION\_ID | - PA OLD: ID\_SESSIONE della RPT - PA NEW: pp.TRANSACTION\_ID |

Anche i campi non riportati in tabella vanno valorizzati dove possibile, secondo la logica già presente per le altre primitive (es. IDENTIFICATIVO\_FRUITORE/EROGATORE, ESITO, ID\_SESSION, STATUS, PAYLOAD, etc…)

Caso prima chiamata multi avviso, i campi (id\_dominio, iuv, ccp, creditor\_reference\_id, notice\_id, payment\_token) contengono le informazioni riferite al **primo** token considerato dalla primitiva/batch.

Caso retry sulla chiamata, come riferimenti alla transazione vanno inseriti solo ID\_SESSIONE\_ORIGINALE e PAYMENT\_TOKEN (le informazioni contenute nella tabella **POSITION\_RETRY\_SENDPAYMENTRESULT**).
