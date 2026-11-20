# Analisi closePayment \[PM \-\> Nodo\]

[closePayment](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/509479359/closePayment)

[A.T. Pagamenti con BPAY su AppIO](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/473563741/A.T.+Pagamenti+con+BPAY+su+AppIO)

Il Payment Manager comunica l’esito del pagamento al Nodo tramite la primitiva closePayment-v1, utilizzando il token di pagamento come identificativo della transazione.

## Input

1. paymentTokens
2. outcome
3. identificativoPsp
4. tipoVersamento
5. identificativoIntermediario
6. identificativoCanale
7. pspTransactionId
8. totalAmount
9. fee
10. timestampOperation
11. additionalPaymentInformations
    1. transactionId
    2. outcomePaymentGateway
    3. authorizationCode

## Output

1. esito

## Diagramma UML

### Validazione Request

Va eseguita la validazione sintattica e semantica della request:

- il primo elemento dell’array `paymentTokens`deve essere popolato con un token noto al Nodo e in corso di validità. Non vanno eseguiti controlli su eventuali altri elementi dell’array, in quanto non previsti;
- il campo `outcome`deve essere popolato con "OK" o "KO";
- i campi `identificativoPsp` , `identificativoIntermediario`, `identificativoCanale` e `tipoVersamento` devono identificare PSP, intermediario e canale noti e abilitati per i pagamenti BANCOMAT Pay, inoltre `identificativoCanale` deve avere il MODELLO\_PAGAMENTO su CANALI\_NODO configurato come “IMMEDIATO” o “IMMEDIATO\_MULTIBENEFICIARIO”;
- il campo `tipoVersamento` deve essere popolato con "BPAY";
- deve essere eseguito un controllo sugli importi dei campi `totalAmount` e `fee` rispetto all'importo aggiornato ricevuto dall'EC in fase di attivazione. In particolare, la differenza (totalAmount - fee) deve essere uguale al POSITION\_PAYMENT.AMOUNT con POSITION\_PAYMENT.PAYMENT\_TOKEN=REQ.paymentTokens\[0\].

è responsabilità del PM invocare la primitiva per i soli pagamenti per cui è prevista (solo pagamenti app IO).

### Esito già acquisito?

Il Nodo valuta se ha già ricevuto una chiamata dal PM per il token di pagamento indicato in request:

```sql
SELECT RICEVUTA_PM
FROM POSITION_PAYMENT pp
WHERE pp.PAYMENT_TOKEN = REQ.paymentTokens[0]
```

Se il flag è a Y, la chiamata viene rifiutata con errore 422 “Esito già acquisito”, indipendentemente dall’esito concorde o discorde con la prima chiamata.

### Token valido?

Il Nodo valuta se il token di pagamento indicato in request sia in corso di validità, altrimenti rifiuta la chiamata con l’errore adeguato.


### INSERT / UPDATE a DB

Le informazioni ricevute dal PM devono essere salvate sul Nodo, così come già avviene per le altre primitive di inoltro esito (es.nodoInoltraEsitoPagamentoPayPal). A tale scopo viene utilizzata la tabella NODO\_ONLINE.PM\_SESSION\_DATA.

### Salvataggio dati a DB

A seguito del buon esito dei controlli di cui sopra, nel caso di outcome OK e token valido il Nodo salva i seguenti dati su `PM_SESSION_DATA` :

| **CAMPO PM\_SESSION\_DATA** | **VALORE** |
| --- | --- |
| ID\_SESSIONE | REQ.paymentTokens\[0\] |
| TIPO | PA NEW:** PAYMENT\_IO**PA OLD: rimane RPT/CARRELLO |
| IMPORTO\_TOTALE\_PAGATO | REQ.totalAmount |
| TIMESTAMP\_OPERAZIONE | REQ.timestampOperation |
| INSERTED\_TIMESTAMP | Timestamp attuale |
| UPDATED\_TIMESTAMP | Timestamp attuale |
| ID\_TRANSAZIONE\_PM\_BPAY | REQ.additionalPaymentInformations.transactionId |
| ID\_TRANSAZIONE\_PSP\_BPAY | REQ.pspTransactionId |
| OUTCOME\_PAYMENT\_GATEWAY | REQ.additionalPaymentInformations.outcomePaymentGateway |
| COMMISSIONE | REQ.fee |
| CODICE\_AUTORIZZATIVO\_BPAY | REQ.additionalPaymentInformations.authorizationCode |


Nel caso di outcome KO i dati non vengono salvati in quanto non sono necessariamente presenti in request. Anche nel caso di closePayment OK a token scaduto, i dati non vengono salvati.

### Aggiornamento dati a DB

#### Update stato RPT/PAYMENT

Lo stato PAYMENT\_RESERVED è stato introdotto nella FSM Payment per tenere traccia della nuova primitiva closePayment. Il PM comunica al Nodo l’esito della prenotazione dell’ammontare: se l’esito è positivo, il Nodo può procedere ad avvisare il PSP con la pspNotifyPaymentRequest. Se invece l’esito risulta negativo (o positivo a token scaduto), il pagamento viene annullato.

##### Caso PA NEW

In questo caso il payment è già stato creato, di conseguenza è sufficiente aggiornare le tabelle `POSITION_PAYMENT_STATUS/SNAPSHOT`

| **ESITO** | **STATO DA** | **STATO A** |
| --- | --- | --- |
| OK | PAYING | PAYMENT\_RESERVED |
| KO | PAYING | CANCELLED |

 

`POSITION_PAYMENT`

|  |  |  |
| --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** |
| FEE | FLOAT | REQ.fee |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |
| UPDATED\_BY | VARCHAR | **closePayment** |


##### Caso PA OLD

Nel caso PA OLD con outcome OK il Nodo provvede alla creazione del payment a seguito della ricezione della primitiva (vedi [BPAY: Traduttore](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/475496810/BPAY+Traduttore)). In caso invece di outcome KO il payment non va creato, di conseguenza bisogna modificare solo lo stato della RPT (vedi [FSM ](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/476119066)di riferimento):

`POSITION_PAYMENT_STATUS/SNAPSHOT`

| **ESITO** | **STATO CREAZIONE** |
| --- | --- |
| OK | PAYMENT\_RESERVED |
| KO | Non viene creato |

`STATI_RPT/SNAPSHOT`

| **ESITO** | **STATO DA** | **STATO A** |
| --- | --- | --- |
| OK | RPT\_PARCHEGGIATA\_NODO | Resta in RPT\_PARCHEGGIATA\_NODO |
| KO | RPT\_PARCHEGGIATA\_NODO | RPT\_ANNULLATA\_WISP |

 

#### Update stato posizione debitoria

Update `POSITION_STATUS/SNAPSHOT`

| **ESITO** | **STATO DA** | **STATO A** |
| --- | --- | --- |
| OK | PAYING | Rimane in PAYING |
| KO | PAYING | INSERTED |

Non sono stati inseriti nuovi stati nella <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/132743900/FSM+Position#NEW-EC-App-IO---BANCOMAT-Pay>. Tuttavia la comunicazione del KO da parte del PM nella request deve far chiudere la posizione debitoria, modificando lo status da PAYING a INSERTED.

 

#### Update dati PSP

Anche riguardo ai dati del PSP, nel caso PA NEW bisogna aggiornare solo la POSITION\_PAYMENT, mentre nel caso PA OLD dipende dal campo outcome:

- outcome **OK**: vanno aggiornate entrambe le tabelle POSITION\_PAYMENT e RPT.
- outcome **KO**: solo la RPT, perché il payment non viene creato.

Nel caso outcome KO, tutti i campi della request (a parte il token) sono opzionali, per cui vengono salvati solo i dati a valore fisso

 

`POSITION_PAYMENT`

| **CAMPO POSITION\_PAYMENT** | **VALORE** |
| --- | --- |
| PAYMENT\_METHOD | **BPAY** |
| PSP\_ID | REQ.identificativoPsp |
| BROKER\_PSP\_ID | REQ.identificativoIntermediario |
| CHANNEL\_ID | REQ.identificativoCanale |
| PAYMENT\_CHANNEL | **WISP** |
| FLAG\_PAYPAL | **N** |
| TRANSACTION\_ID | REQ.additionalPaymentInformations.transactionId |

`RPT`

| **CAMPO RPT** | **VALORE** |
| --- | --- |
| TIPO\_VERSAMENTO | **BPAY** |
| PSP | REQ.identificativoPsp |
| INTERMEDIARIOPSP | REQ.identificativoIntermediario |
| CANALE | REQ.identificativoCanale |

 

In entrambi i casi, va anche aggiornatala tabella `POSITION_ACTIVATE` con il PSP selezionato dall’utente per il pagamento, che va a rimpiazzare il PSP fittizio salvato a DB:

| **CAMPO POSITION\_ACTIVATE** | **VALORE** |
| --- | --- |
| PSP\_ID | REQ.identificativoPsp |

 

#### Update scadenza token

Sempre nella tabella `POSITION_ACTIVATE` va aggiornata la durata del token (campo `TOKEN_VALID_TO`) a seconda dell'esito contenuto in request:

| **ESITO** | **VALORE** |
| --- | --- |
| OK | CURRENT\_TIMESTAMP+**default\_durata\_estensione\_token\_IO** |
| KO | CURRENT\_TIMESTAMP |

La durata del token NON va prolungata nel caso in cui cui la closePayment OK request arrivi a token scaduto: in quel caso il campo non viene aggiornato.

 

### Salvataggio log su Registro Eventi

Per la chiamata closePayment è previsto il salvataggio dei seguenti log su RE:

- log di request e response, secondo la modalità già presente per le altre primitive, anche nel caso di retry inattesi;
- log dei eventuali cambi di stato:
    - payment\_PAYMENT\_RESERVED
    - payment\_CANCELLED
    - position\_INSERTED

I campi riportati nella tabella seguente sono mandatori. Le informazioni assenti in request vanno recuperate tramite JOIN POSITION\_PAYMENT pp ON pp.PAYMENT\_TOKEN=REQ.paymentTokens\[0\].

| **CAMPI OBBLIGATORI** | **VALORE REQ/RESP** | **VALORE CAMBIO STATO** |
| --- | --- | --- |

| **CAMPI OBBLIGATORI** | **VALORE REQ/RESP** | **VALORE CAMBIO STATO** |
| --- | --- | --- |
| IDENTIFICATIVO\_DOMINIO | pp.PA\_FISCAL\_CODE | pp.PA\_FISCAL\_CODE |
| IDENTIFICATIVO\_UNIVOCO\_VERSAMENTO | pp.CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID |
| CODICE\_CONTESTO\_PAGAMENTO | REQ.paymentTokens\[0\] | REQ.paymentTokens\[0\] |
| IDENTIFICATIVO\_PRESTATORE\_SERVIZI\_PAGAMENTO | REQ.identificativoPsp | REQ.identificativoPsp |
| COMPONENTE | **FESP** | **FESP** |
| CATEGORIA\_EVENTO | **INTERFACCIA** | **INTERNO** |
| TIPO\_EVENTO | **closePayment-v1** | **closePayment-v1** |
| SOTTO\_TIPO\_EVENTO | **REQ/RESP** | **INTERN** |
| IDENTIFICATIVO\_STAZIONE\_INTERMEDIARIO\_PA | pp.STATION\_ID | pp.STATION\_ID |
| CANALE\_PAGAMENTO | REQ.identificativoCanale | REQ.identificativoCanale |
| BUSINESS\_PROCESS | **closePayment-v1** | **closePayment-v1** |
| NOTICE\_ID | pp.NOTICE\_ID | pp.NOTICE\_ID |
| CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID |
| PAYMENT\_TOKEN | REQ.paymentTokens\[0\] | REQ.paymentTokens\[0\] |
| ID\_SESSIONE\_ORIGINALE | - PA OLD: ID\_SESSIONE della RPT - PA NEW: REQ.paymentTokens\[0\] | - PA OLD: ID\_SESSIONE della RPT - PA NEW: REQ.paymentTokens\[0\] |

Anche i campi non riportati in tabella vanno valorizzati dove possibile, secondo la logica già presente per le altre primitive (es. IDENTIFICATIVO\_FRUITORE/EROGATORE, ESITO, ID\_SESSION, STATUS, PAYLOAD, etc…)


## Biz negativi

Questa primitiva può scatenare l'invio di Eventi BIZ negativi come descritto in [\[WIP\] A.T. Eventi di business negativi](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/665026818/A.T.+Eventi+di+business+negativi)

 
