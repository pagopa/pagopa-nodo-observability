# Analisi paymentStatus

## Scopo

Descoping di [PG-150](https://pagopa.atlassian.net/browse/PG-150)

Ecommerce ha la necessità di poter recuperare lo stato effettivo del singolo payment durante il processo di pagamento. Questo al fine di avere informazioni aggiuntive circa lo stato del pagamento, soprattutto nei casi in cui la sendPaymentResultV2 andasse persa.

## Request e Response

### PATH

`GET /paymentstatus?paymenttoken={payment_token}&caller={caller}`

`GET /paymentstatus?paymenttoken={payment_token}&caller={caller}?&daysToGoBack={daysToGoBack}`


## PaymentStatusData - Validazione con Regex

| Campo | Tipo | Regex | Valido | Invalido |
| --- | --- | --- | --- | --- |
| id | Long | ^\[0-9\]+$ | 12345 | -123 / ABC |
| pa\_fiscal\_code | String(11) | ^\[0-9\]{11}$ | 01234567891 | 0123456789 / 012345678901 |
| notice\_id | String(18) | ^\[0-9\]{18}$ | 012345678912345678 | 01234567891234567 / ABC123... |
| creditor\_reference\_id | String(≤35) | ^.{1,35}$ | IUV-ABC-12345 | (empty) / \>35 char |
| payment\_token | String(32) | ^\[a-zA-Z0-9\]{32}$ | 01234567aaaabbbbcccc012345678912 | short / special chars |
| status | Enum | ^(PAYING\|PAID\|FAILED\|CANCELLED\|NOTIFIED\|...)$ | PAID / CANCELLED | paid / INVALID |
| inserted\_timestamp | ISO8601 | ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$ | 2026-07-14T12:25:58.679Z | 2026-07-14 12:25:58 |
| updated\_timestamp | ISO8601 | ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?Z$ | 2026-07-14T12:26:58Z | 14/07/2026 12:26:58 |
| fk\_position\_payment | Long | ^\[0-9\]+$ | 12345 | -123 / ABC |
| inserted\_by | String(≤255) | ^\[a-zA-Z0-9\\-\_\]{1,255}$ | activatePaymentNoticeV2 | empty / special chars |
| updated\_by | String(≤255) | ^\[a-zA-Z0-9\\-\_\]{1,255}$ | closePayment-V2 | empty / spaces |

## Query Parameters Validazione

| Parametro | Obbligatorio | Regex | Valido | Errore |
| --- | --- | --- | --- | --- |
| paymenttoken | ✅ | ^\[a-zA-Z0-9\]{32}$ | 01234567aaaabbbbcccc012345678912 | 400 - "token deve essere 32 char alfanumerici" |
| caller | ✅ | ^\[a-zA-Z0-9\]{1,35}$ | eCommerce / TEST | 400 - "caller max 35 char alfanumerici" |
| daysToGoBack | ❌ | ^\[0-9\]{1,2}$ | 0 / 7 / 89 | 400 - "daysToGoBack \< 90" |

## Validazioni Aggiuntive

| Regola | Condizione | Errore |
| --- | --- | --- |
| No Body JSON | GET non accetta payload | 400 - "GET request non deve avere body JSON" |
| Solo Query Params | Tutti parametri in URL | 400 se parametri in body |
| Timestamp validi | inserted/updated ≤ NOW() | Dal DB, non input |
| Updated ≥ Inserted | updated\_ts ≥ inserted\_ts | Dal DB, non input |

### RESP


```
{
	"payment_status": {
		"id": 12345,
		"pa_fiscal_code": "01234567891",
		"notice_id": "012345678912345678",
		"creditor_reference_id": "345678912345678",
		"payment_token": "01234567aaaabbbbcccc012345678912",
		"status": "PAYING",
		"inserted_timestamp": "2026-07-14T12:25:58.679Z", // timestamp con fuso orario
		"updated_timestamp": "2026-07-14T12:26:58.679Z", // timestamp con fuso orario
		"fk_position_payment": 12345,
		"inserted_by": "activatePaymentNoticeV2",
		"updated_by": "closePayment-V2"
	}
}
```

### Oggetto della response Api, stati e descrizione

```
// Ogetto della response Api, stati e descrizione

"PaymentStatusData" : {
        "required" : [ "id", "pa_fiscal_code", "notice_id", "creditor_reference_id", "payment_token", "status", "inserted_timestamp", "updated_timestamp", "fk_position_payment", "inserted_by", "updated_by" ],
        "type" : "object",
        "properties" : {
          "id" : {
            "type" : "integer",
            "format" : "int64",
            "description" : "Identificativo univoco del pagamento nel sistema"
          },
          "pa_fiscal_code" : {
            "type" : "string",
            "description" : "Codice fiscale dell'ente creditore (PA) che ha ricevuto il pagamento"
          },
          "notice_id" : {
            "type" : "string",
            "description" : "Numero dell'avviso di pagamento (IUV) formato esteso 18 caratteri"
          },
          "creditor_reference_id" : {
            "type" : "string",
            "description" : "Identificativo del creditore dal sistema del PSP"
          },
          "payment_token" : {
            "type" : "string",
            "description" : "Token univoco a 32 caratteri che identifica il pagamento nel sistema nodo4"
          },
          "status": {
  "type": "string",
  "description": "Payment Status - Enum Stati: PAYING (IN CORSO), PAYING_RPT (IN CORSO), PAID_NORPT (OK), PAID (OK), FAILED_NORPT (KO), FAILED (KO), CANCELLED (KO), CANCELLED_NORPT (KO), NOTICE_GENERATED (OK), NOTICE_STORED (OK), NOTICE_SENT (OK), NOTIFIED (OK), PAYMENT_SENT (IN CORSO), PAYMENT_REFUSED (KO), PAYMENT_SEND_ERROR (KO), PAYMENT_ACCEPTED (OK), PAYMENT_UNKNOWN (IN CORSO), PAYMENT_RESERVED (IN CORSO).",
  "enum": [
    "PAYING",
    "PAYING_RPT",
    "PAID_NORPT",
    "PAID",
    "FAILED_NORPT",
    "FAILED",
    "CANCELLED",
    "CANCELLED_NORPT",
    "NOTICE_GENERATED",
    "NOTICE_STORED",
    "NOTICE_SENT",
    "NOTIFIED",
    "PAYMENT_SENT",
    "PAYMENT_REFUSED",
    "PAYMENT_SEND_ERROR",
    "PAYMENT_ACCEPTED",
    "PAYMENT_UNKNOWN",
    "PAYMENT_RESERVED"
  ]
}
,          "inserted_timestamp" : {
            "type" : "string",
            "format" : "date-time",
            "description" : "Data e ora di creazione del pagamento nel formato ISO 8601 con fuso orario"
          },
          "updated_timestamp" : {
            "type" : "string",
            "format" : "date-time",
            "description" : "Data e ora dell'ultimo aggiornamento dello stato nel formato ISO 8601 con fuso orario"
          },
          "fk_position_payment" : {
            "type" : "integer",
            "format" : "int64",
            "description" : "Identificativo univoco del pagamento nella tabella POSITION_PAYMENT del DB del Nodo"
          },
          "inserted_by" : {
            "type" : "string",
            "description" : "Primitiva o attore che ha creato il pagamento (es. activatePaymentNoticeV2)"
          },
          "updated_by" : {
            "type" : "string",
            "description" : "Primitiva o attore che ha aggiornato per ultimo lo stato del pagamento (es. nodoInviaRT, closePayment-v2)"
          }
        }
      }


      
```


| ## Payment Status - Dettaglio Campi CampoDescrizioneDominioSignificato`id`Identificativo univoco del record di pagamentoLong (numero intero)Chiave primaria della tabella position\_payment\_status\_snapshot`pa_fiscal_code`Codice fiscale della Pubblica Amministrazione (ente creditore)String (11 cifre numeriche)Identifica univocamente l'ente creditore/PA che riceve il pagamento`notice_id`Numero di avviso di pagamento (bollettino)String (18 cifre numeriche)Identificativo dell'avviso di pagamento generato dalla PA`creditor_reference_id`Codice IUV (Identificativo Univoco di Versamento)String (fino a 35 caratteri)Identificativo univoco della posizione debitoria presso l'ente`payment_token`Token univoco generato per identificare il pagamento nel ciclo di vitaString (32 caratteri alfanumerici)Chiave per tracciare il pagamento da attivazione a conclusione`status`Stato attuale del pagamento nel ciclo di vitaEnum (vedi tabella sottostante)Indica la fase del pagamento: in corso, pagato, fallito, annullato, ecc.`inserted_timestamp`Data e ora di creazione del recordISO 8601 DateTime with timezone (es. 2026-07-14T12:25:58.679Z)Timestamp di quando il pagamento è stato registrato nel sistema`updated_timestamp`Data e ora dell'ultimo aggiornamento del recordISO 8601 DateTime with timezone (es. 2026-07-14T12:26:58.679Z)Timestamp dell'ultima modifica dello stato del pagamento`fk_position_payment`Chiave esterna verso il record position\_paymentLong (numero intero)Referenza alla posizione di pagamento padre (contiene dati su PSP, importo, ecc.)`inserted_by`Nome della primitiva/actor che ha creato il recordString (nome primitiva, es. activatePaymentNoticeV2)Tracciabilità dell'operazione che ha generato il pagamento`updated_by`Nome della primitiva/actor che ha modificato per ultimo il recordString (nome primitiva, es. closePayment-V2, nodoInviaRT)Tracciabilità dell'operazione che ha aggiornato lo stato del pagamento  ## 🔄 Payment Status - Enum Stati Stato (Enum)SignificatoEsito`PAYING`Pagamento in corso⏳ IN CORSO`PAYING_RPT`Pagamento in corso con RPT (Richiesta di Pagamento Telematico)⏳ IN CORSO`PAID_NORPT`Pagamento concluso per RPT non ancora arrivata✓ OK`PAID`Pagamento concluso con ricevuta generata✓ OK`FAILED_NORPT`Pagamento fallito senza RPT✗ KO`FAILED`Pagamento fallito ✗ KO`CANCELLED`Pagamento annullato da sistema✗ KO`CANCELLED_NORPT`Pagamento annullato da sistema senza RPT ✗ KO`NOTICE_GENERATED`Ricevuta di pagamento generata da sistema✓ OK`NOTICE_STORED`Ricevuta di pagamento generata e da non inviare alla PA (caso RPT in cui viene inviata la RT e non la receipt)✓ OK`NOTICE_SENT`Ricevuta di pagamento inviata alla PA✓ OK`NOTIFIED`Ricevuta di pagamento ricevuta dalla PA✓ OK`PAYMENT_SENT`Pagamento inviato al PSP per l'elaborazione (NMU)⏳ IN CORSO`PAYMENT_REFUSED`Pagamento rifiutato dal PSP (NMU)✗ KO`PAYMENT_SEND_ERROR`Errore di comunicazione nell'invio del pagamento al PSP (NMU)✗ KO`PAYMENT_ACCEPTED`Pagamento accettato dal PSP (NMU)✓ OK`PAYMENT_UNKNOWN`Risposta del PSP sconosciuta esempio timeout o errore response (NMU)⏳ IN CORSO`PAYMENT_RESERVED`Pagamento in preparazione di invio al PSP (NMU)⏳ IN CORSO  ### 📌 Legenda Esiti: - **✓ OK** = Pagamento concluso con successo - **⏳ IN CORSO** = Pagamento in elaborazione, status intermedio - **✗ KO** = Pagamento fallito, rifiutato o annullato |  |  |  |
| --- | --- | --- | --- |
| Campo | Descrizione | Dominio | Significato |
| `id` | Identificativo univoco del record di pagamento | Long (numero intero) | Chiave primaria della tabella position\_payment\_status\_snapshot |
| `pa_fiscal_code` | Codice fiscale della Pubblica Amministrazione (ente creditore) | String (11 cifre numeriche) | Identifica univocamente l'ente creditore/PA che riceve il pagamento |
| `notice_id` | Numero di avviso di pagamento (bollettino) | String (18 cifre numeriche) | Identificativo dell'avviso di pagamento generato dalla PA |
| `creditor_reference_id` | Codice IUV (Identificativo Univoco di Versamento) | String (fino a 35 caratteri) | Identificativo univoco della posizione debitoria presso l'ente |
| `payment_token` | Token univoco generato per identificare il pagamento nel ciclo di vita | String (32 caratteri alfanumerici) | Chiave per tracciare il pagamento da attivazione a conclusione |
| `status` | Stato attuale del pagamento nel ciclo di vita | Enum (vedi tabella sottostante) | Indica la fase del pagamento: in corso, pagato, fallito, annullato, ecc. |
| `inserted_timestamp` | Data e ora di creazione del record | ISO 8601 DateTime with timezone (es. 2026-07-14T12:25:58.679Z) | Timestamp di quando il pagamento è stato registrato nel sistema |
| `updated_timestamp` | Data e ora dell'ultimo aggiornamento del record | ISO 8601 DateTime with timezone (es. 2026-07-14T12:26:58.679Z) | Timestamp dell'ultima modifica dello stato del pagamento |
| `fk_position_payment` | Chiave esterna verso il record position\_payment | Long (numero intero) | Referenza alla posizione di pagamento padre (contiene dati su PSP, importo, ecc.) |
| `inserted_by` | Nome della primitiva/actor che ha creato il record | String (nome primitiva, es. activatePaymentNoticeV2) | Tracciabilità dell'operazione che ha generato il pagamento |
| `updated_by` | Nome della primitiva/actor che ha modificato per ultimo il record | String (nome primitiva, es. closePayment-V2, nodoInviaRT) | Tracciabilità dell'operazione che ha aggiornato lo stato del pagamento |
| Stato (Enum) | Significato | Esito |  |
| `PAYING` | Pagamento in corso | ⏳ IN CORSO |  |
| `PAYING_RPT` | Pagamento in corso con RPT (Richiesta di Pagamento Telematico) | ⏳ IN CORSO |  |
| `PAID_NORPT` | Pagamento concluso per RPT non ancora arrivata | ✓ OK |  |
| `PAID` | Pagamento concluso con ricevuta generata | ✓ OK |  |
| `FAILED_NORPT` | Pagamento fallito senza RPT | ✗ KO |  |
| `FAILED` | Pagamento fallito | ✗ KO |  |
| `CANCELLED` | Pagamento annullato da sistema | ✗ KO |  |
| `CANCELLED_NORPT` | Pagamento annullato da sistema senza RPT | ✗ KO |  |
| `NOTICE_GENERATED` | Ricevuta di pagamento generata da sistema | ✓ OK |  |
| `NOTICE_STORED` | Ricevuta di pagamento generata e da non inviare alla PA (caso RPT in cui viene inviata la RT e non la receipt) | ✓ OK |  |
| `NOTICE_SENT` | Ricevuta di pagamento inviata alla PA | ✓ OK |  |
| `NOTIFIED` | Ricevuta di pagamento ricevuta dalla PA | ✓ OK |  |
| `PAYMENT_SENT` | Pagamento inviato al PSP per l'elaborazione (NMU) | ⏳ IN CORSO |  |
| `PAYMENT_REFUSED` | Pagamento rifiutato dal PSP (NMU) | ✗ KO |  |
| `PAYMENT_SEND_ERROR` | Errore di comunicazione nell'invio del pagamento al PSP (NMU) | ✗ KO |  |
| `PAYMENT_ACCEPTED` | Pagamento accettato dal PSP (NMU) | ✓ OK |  |
| `PAYMENT_UNKNOWN` | Risposta del PSP sconosciuta esempio timeout o errore response (NMU) | ⏳ IN CORSO |  |
| `PAYMENT_RESERVED` | Pagamento in preparazione di invio al PSP (NMU) | ⏳ IN CORSO |  |
|  |  |  |  |
|  |  |  |  |

#### Tabella Mapping HTTP Response Code

| HTTP Status | Scenario | Query Params REQ | Response Body | Descrizione |
| --- | --- | --- | --- | --- |
| **200 OK** | Pagamento trovato | `?paymenttoken=XXX&caller=eCommerce&daysToGoBack=2` | `{ "position_status_snapshot": {...}, "position_payment_status_snapshot": {...} }` | Pagamento recuperato con successo. |
| **400 Bad Request** | Token non valido | `?paymenttoken=invalid&caller=eCommerce` | `{ "error": "Payment token deve essere 32 caratteri alfanumerici" }` | Token non è 32 caratteri alfanumerici. |
| **400 Bad Request** | Caller mancante | `?paymenttoken=01234567aaaabbbbcccc012345678912` | `{ "error": "Caller deve essere max 35 caratteri alfanumerici" }` | Parametro caller è vuoto o assente. |
| **400 Bad Request** | daysToGoBack \>= 90 | `?paymenttoken=XXX&caller=eCommerce&daysToGoBack=100` | `{ "error": "DaysToGoBack deve essere < 90" }` | daysToGoBack non può essere \>= 90. |
| **400 Bad Request** | Caller con special chars | `?paymenttoken=XXX&caller=test@invalid` | `{ "error": "Caller deve essere max 35 caratteri alfanumerici" }` | Caller deve contenere solo caratteri alfanumerici. |
| **404 Not Found** | Pagamento non trovato | `?paymenttoken=ffffffffffffffffffffffffffffffff&caller=eCommerce` | `{ "error": "Pagamento non trovato" }` | Nessun pagamento trovato nel database. |
| **500 Internal Server Error** | Errore interno | Qualsiasi | `{ "error": "Errore interno del server" }` | Errore database o eccezione inaspettata. |

Dove la struttura riporta esattamente i dati presenti a DB nel record della tabella `POSITION_PAYMENT_STATUS_SNAPSHOT` relativo al token in input.

### Obbligatorietà e check sintattici

In REQ, `paymenttoken` e `caller` sono obbligatori mentre `daysToGoBack` è opzionale.

La validazione sintattica da effettuare sui singoli campi è:

- {paymenttoken} → stringa di 32 caratteri alfanumerici
- {caller} → stringa di max 35 caratteri alfanumerici
- {daysToGoBack} → opzionale, numero intero inferiore a 90 (1 .. 89) 

### Generazione Response

Per poter costruire il body della response, il Nodo deve riportare i dati presenti sul DB di traffico live senza effettuare alcuna manipolazione (NB: qualora i dati presenti sul DB live fossero inferiori a 90 giorni, vince la retention dei dati sul DB di traffico come limite temporale). Per individuare il record da restituire in response, la logica da utilizzare è: 

- STEP 1: identificare il record della `POSITION_PAYMENT_STATUS_SNAPSHOT` 
    - ricerca con chiave`payment_token = {token}` e, se presente, `AND inserted_timestamp > CURRENT_DATE - INTERVAL '{daysToGoBack} days'`
    - **NB**: se su DB live sono presenti solo 60gg di traffico, anche se `daysToGoBack`= 89, l’API cercherà il token solo sui 60gg presenti. NON è previsto di interrogare il db di stoico.
- STEP 2: generazione response
    - se è stato trovato un record allo STEP 1, response http 200 con body completo (vd schema response) → END
    - se non è stato trovato alcun payment, generare una response 404 di “pagamento non trovato” (vd schema response) → END

### Casi funzionali particolari RESP

#### Payment presente

```
httpStatus = 200

{
	"payment_status": {
		"id": 12345,
		"pa_fiscal_code": "01234567891",
		"notice_id": "012345678912345678",
		"creditor_reference_id": "345678912345678",
		"payment_token": "01234567aaaabbbbcccc012345678912",
		"status": "PAYING",
		"inserted_timestamp": "2026-07-14T12:25:58.679Z", // timestamp con fuso orario
		"updated_timestamp": "2026-07-14T12:26:58.679Z", // timestamp con fuso orario
		"fk_position_payment": 12345,
		"inserted_by": "activatePaymentNoticeV2",
		"updated_by": "closePayment-V2"
	}
}
```

#### Payment non presente

```
httpStatus = 404

{
	"error": "Pagamento non trovato"
}
```

## Gestione lock a DB

In caso il Payment fosse lockato da altri processi, la chiamata sarà costretta ad aspettare il liberarsi del lock per poter rispondere. Questo può avere impatti sensibili sui tempi di risposta e, di conseguenza, sugli SLA. Essendo un’API puramente di flusso, le probabilità del verificarsi di questi lock non è elevata, ma comunque possibile.

## Popolamento RE

REQ e RESP vanno tracciate sul registro eventi e va inoltre previsto l’invio degli eventi a eventhub come per ogni evento RE.

Con ppss = POSITION\_PAYMENT\_STATUS\_SNAPSHOT:

| **Campo** | **Valore REQ** | **Valore RESP 200** | **Valore RESP 400/404** |
| --- | --- | --- | --- |
| DATA\_ORA\_EVENTO | come per altre scritture RE | come per altre scritture RE | come per altre scritture RE |
| INSERTED\_TIMESTAMP | come per altre scritture RE. NB: timestamp evento, non timestamp scrittura a DB | come per altre scritture RE. NB: timestamp evento, non timestamp scrittura a DB | come per altre scritture RE. NB: timestamp evento, non timestamp scrittura a DB |
| IDENTIFICATIVO\_DOMINIO | ppss.PA\_FISCAL\_CODE | ppss.PA\_FISCAL\_CODE | - |
| IDENTIFICATIVO\_UNIVOCO\_VERSAMENTO | ppss.CREDITOR\_REFERENCE\_ID | ppss.CREDITOR\_REFERENCE\_ID | - |
| CODICE\_CONTESTO\_PAGAMENTO | REQ.paymenttoken | REQ.paymenttoken | REQ.paymenttoken |
| IDENTIFICATIVO\_PRESTATORE\_SERVIZI\_PAGAMENTO | **AGID\_01** | **AGID\_01** | **AGID\_01** |
| COMPONENTE | **FESP** | **FESP** | **FESP** |
| CATEGORIA\_EVENTO | **INTERFACCIA** | **INTERFACCIA** | **INTERFACCIA** |
| TIPO\_EVENTO | **paymentStatus** | **paymentStatus** | **paymentStatus** |
| SOTTO\_TIPO\_EVENTO | **REQ** | **RESP** | **RESP** |
| IDENTIFICATIVO\_FRUITORE | **eCommerce** | **eCommerce** | **eCommerce** |
| IDENTIFICATIVO\_EROGATORE | **NodoDeiPagamentiSPC** | **NodoDeiPagamentiSPC** | **NodoDeiPagamentiSPC** |
| ESITO | RICEVUTA | INVIATA | INVIATA |
| ID\_SESSIONE | idSessione del Nodo, presente anche a log | idSessione del Nodo, presente anche a log | idSessione del Nodo, presente anche a log |
| PAYLOAD | body request | body response | body resposne |
| INFO | REQ.\[queryString\] | - | - |
| BUSINESS\_PROCESS | **paymentStatus** | **paymentStatus** | **paymentStatus** |
| NOTICE\_ID | ppss.NOTICE\_ID | ppss.NOTICE\_ID | - |
| CREDITOR\_REFERENCE\_ID | ppss.CREDITOR\_REFERENCE\_ID | ppss.CREDITOR\_REFERENCE\_ID | - |
| PAYMENT\_TOKEN | REQ.paymenttoken | REQ.paymenttoken | REQ.paymenttoken |
| ID\_EVENTHUB | come per altre scritture RE | come per altre scritture RE | come per altre scritture RE |

---

link utili

- [Analisi verifyPaymentNotice](https://pagopa.atlassian.net/wiki/x/r4DNGg)
- [NDP \`CheckPosition\`](https://pagopa.atlassian.net/wiki/x/JgBIng)
-  [PIDM-1117: NODO - API Recupero statoResolved](https://pagopa.atlassian.net/browse/PIDM-1117)
- [Database Nodo dei Pagamenti](https://pagopa.atlassian.net/wiki/x/jQ7lFg)
- NDP tech supp [SwaggerEditor](https://editor.swagger.io/?url=https://raw.githubusercontent.com/pagopa/pagopa-node-technical-support-worker/main/openapi/openapi.json) GET `/paymentToken/{paymentToken}` Position Payment Snapshot Resource `POSITION_PAYMENT_STATUS_SNAPSHOT`
- [SwaggerEditor](https://editor.swagger.io/?url=https://raw.githubusercontent.com/pagopa/pagopa-infra/356e30b483427b54fc71abd67ef829b8acb47b46/src/domains/ecommerce-app/api/ecommerce-payment-requests-service/v1/_openapi.json.tpl) Pagopa eCommerce payment requests service

*online schema : current month plus the previous 2*
