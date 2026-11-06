# Analisi activatePaymentNotice

<https://pagopa.github.io/pagopa-api/#operation/activatePaymentNotice> 

[Activate](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/240713936/Activate)

[DR - Verificatore (APIM policy)](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/433914753/DR+-+Verificatore+APIM+policy)

[FSM Position](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/132743900/FSM+Position)

[FSM Payment](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/120982308/FSM+Payment)

[FSM Transizioni Payment-Receipt](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/136119901/FSM+Transizioni+Payment-Receipt)

Per il PSP, l'obiettivo dell'activate è di attivare il processo di pagamento ed avere le informazioni necessarie al pagamento e ai riversamenti. Il PSP aspetta la risposta OK per far procedere l'utente finale al pagamento della posizione.

Il processo di activate prevede i seguenti task:

- gestione della chiave di idempotenza con la quale si presenta il PSP 
- gestire dialogo con la PA nelle modalità previste
- salvataggio dei dati della posizione per i step successivi del processo di pagamento
- generazione di una risposta verso il PSP

## Endpoint

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/nodo/nodeForPsp.wsdl#L126> 

## Parametri di input

- idPSP
- idBrokerPSP
- idChannel
- password
- idempotencyKey
- qrCode
    - fiscalCode
    - noticeNumber
- expirationTime (optional)
- amount (optional)
- dueDate (optional)
- paymentNote (optional)

## Parametri di output 

- outcome
- totalAmount
- paymentDecription
- fiscalCodePA
- companyName
- officeName
- paymentToken
- transferList
    - transfer{1..5}
        - idTransfer
        - transferAmount
        - fiscalCodePA
        - IBAN
        - remittanceInformation
- creditorReferenceId
- standin (optional)



## nodo valida xml

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/nodo/nodeForPsp.xsd#L675> 

Il Nodo effettua valutazioni sintattiche e semantiche sulla request ricevuta.

In caso di errori risponderà rispettivamente con i fault code **PPT\_SINTASSI\_EXTRAXSD** e **PPT\_SEMANTICA**.


## gestione idempotenza

Il Nodo verifica sulla tabella IDEMPOTENCY\_CACHE la presenza di un record con idPSP e idempotencyKey presenti nella request della activatePaymentNotice e con data VALID\_TO maggiore o uguale alla data odierna.

[Idempotenza \[Design Review\]](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/159711301/Idempotenza+Design+Review)

## prima verifica posizione debitoria

Il Nodo verifica lo stato della posizione debitoria dalla tabella POSITION\_STATUS\_SNAPSHOT per verificare che la posizione non abbia già un pagamento in corso o sia già stata pagata.

Se lo stato è PAYING, il Nodo risponde con l’errore **PPT\_PAGAMENTO\_IN\_CORSO**.

Se lo stato è PAID o NOTIFIED, il Nodo risponde con l’errore **PPT\_PAGAMENTO\_DUPLICATO**.

La posizione debitoria identificata viene bloccata in questo punto per evitare la concorrenza di chiamate successive.


## nodo genera payment token

[Payment Token](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/92537506/Payment+Token)

Il token di pagamento viene creato tramite la rimozione dei caratteri dash da un codice UUID generato randomicamente.


## INSERT su POSITION\_ACTIVATE

Primo salvataggio dopo l'arrivo della chiamata activatePaymentNotice.

A seguito del salvataggio viene sbloccata la posizione debitoria.

|  |  |  |  |
| --- | --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** | **NOTE** |
| ID | NUMBER | Sequence |  |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |  |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |  |
| CREDITOR\_REFERENCE\_ID | VARCHAR |  |  |
| PSP\_ID | VARCHAR | activatePaymentNotice.REQ.idPSP |  |
| IDEMPOTENCY\_KEY | VARCHAR | activatePaymentNotice.REQ.idempotencyKey |  |
| PAYMENT\_TOKEN | VARCHAR | **GENERATO DAL NODO** |  |
| TOKEN\_VALID\_FROM | TIMESTAMP |  |  |
| TOKEN\_VALID\_TO | TIMESTAMP |  |  |
| DUE\_DATE | TIMESTAMP | activatePaymentNotice.REQ.dueDate |  |
| AMOUNT | FLOAT | activatePaymentNotice.REQ.amount |  |
| INSERTED\_TIMESTAMP | TIMESTAMP | SYSTIMESTAMP |  |


## nodo gestisce paGetPayment

Il Nodo invia paGetPayment Request; per decidere quale versione utilizzare (V1 o V2) il nodo verifica il valore del campo STAZIONE.VERSIONE\_PRIMITIVE.

| **VALORE CAMPO** | **PRIMITIVA DA UTILIZZARE** |
| --- | --- |
| 1 | [Analisi paGetPayment](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/449675425/Analisi+paGetPayment) |
| 2 | [Analisi paGetPayment v2](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/526974990/Analisi+paGetPayment+v2) |

#### Gestione stand-in (vd [Analisi Stand-in](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/843645183/Analisi+Stand-in) )

In caso la stazione identificata a partire dal numero avviso fosse censita nell'elenco delle stazioni in stand-in, il Nodo produrrà una paGetPayment/V2 in tutto e per tutto identica a quella destinata alla stazione originale ma la inoltrerà a ACA (`CONFIGURATION_KEYS.station.stand-in`). 

Il fatto che il pagamento sia stato gestito in stand-in viene tracciato a DB sia sulla POSITION\_PAYMENT che su RE (solo nel record relativo alla REQ della chiamata verso ACA). 


A seguito della ricezione della paGetPaymentResponse, il Nodo blocca nuovamente l’accesso alla posizione debitoria sul DB.

## seconda verifica posizione debitoria

Il Nodo verifica la coerenza tra quanto ricevuto nella response della primitiva paGetPayment e quanto salvato a DB in precedenza. Viene verificata anche l’assenza di record duplicati della posizione debitoria.


## SELECT su POSITION\_SERVICE

### POSITION\_SERVICE (INSERT/UPDATE)

Se la posizione è presente sul Nodo viene effettuata una update del dato, aggiornando il valore UPDATED\_TIMESTAMP.

```sql
SELECT * 
FROM POSITION_SERVICE 
WHERE PA_FISCAL_CODE=<activatePaymentNotice REQ.qrCode.fiscalCode> 
AND NOTICE_ID=<activatePaymentNotice REQ.qrCode.noticeNumber>
```


|  |  |  |  |
| --- | --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** | **NOTA** |
| ID | NUMBER | SEQUENCE |  |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |  |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |  |
| DESCRIPTION | VARCHAR | paGetPayment RESP.data.description |  |
| COMPANY\_NAME | VARCHAR | paGetPayment RESP.data.companyName |  |
| OFFICE\_NAME | VARCHAR | paGetPayment RESP.data.officeName |  |
| DEBTOR\_ID | NUMBER | **POSITION\_SUBJECT.ID inserito in precedenza** |  |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** | valorizzare solo in insert |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |  |


## INSERT su POSITION\_SUBJECT(INSERT/UPDATE)

Se la posizione è presente sul Nodo viene effettuata una update del dato, aggiornando il valore UPDATED\_TIMESTAMP. 

|  |  |  |
| --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** |
| ID | NUMBER | SEQUENCE |
| SUBJECT\_TYPE | VARCHAR | **DEBTOR** |
| ENTITY\_UNIQUE\_IDENTIFIER\_TYPE | VARCHAR | paGetPayment RESP.data.debtor.uniqueIdentifier.entityUniqueIdentifierType |
| ENTITY\_UNIQUE\_IDENTIFIER\_VALUE | VARCHAR | paGetPayment RESP.data.debtor.uniqueIdentifier.entityUniqueIdentifierValue |
| FULL\_NAME | VARCHAR | paGetPayment RESP.data.debtor.fullName |
| STREET\_NAME | VARCHAR | paGetPayment RESP.data.debtor.streetName |
| CIVIC\_NUMBER | VARCHAR | paGetPayment RESP.data.debtor.civicNumber |
| POSTAL\_CODE | VARCHAR | paGetPayment RESP.data.debtor.postalCode |
| CITY | VARCHAR | paGetPayment RESP.data.debtor.city |
| STATE\_PROVINCE\_REGION | VARCHAR | paGetPayment RESP.data.debtor.stateProvinceRegion |
| COUNTRY | VARCHAR | paGetPayment RESP.data.debtor.country |
| EMAIL | VARCHAR | paGetPayment RESP.data.debtor.e-mail |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |


## SELECT su POSITION\_PAYMENT\_PLAN

### POSITION\_PAYMENT\_PLAN (INSERT/UPDATE)

Occorre verificare se serve inserire una nuova riga oppure aggiornare. 

```sql
SELECT *
FROM POSITION_SERVICE A JOIN POSITION_PAYMENT_PLAN B ON (B.FK_POSITION_SERVICE=A.ID)
WHERE A.PA_FISCAL_CODE=<activatePaymentNotice REQ.qrCode.fiscalCode> 
AND A.NOTICE_ID=<activatePaymentNotice REQ.qrCode.noticeNumber>
AND B.DUE_DATE=<paGetPayment RESP.data.dueDate>
AND B.AMOUNT=<paGetPayment RESP.data.paymentAmount>
AND B.CREDITOR_REFERENCE_ID=<paGetPayment RESP.data.creditorReferenceId>
```

 Se riga trovata si aggiorna.

|  |  |  |  |
| --- | --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI INSERT** | **VALORI UPDATE** |
| ID  | NUMBER | SEQUENCE |  |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |  |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |  |
| CREDITOR\_REFERENCE\_ID | VARCHAR | paGetPayment RESP.data.creditorReferenceId |  |
| DUE\_DATE | TIMESTAMP | paGetPayment RESP.data.dueDate |  |
| RETENTION\_DATE | TIMESTAMP | paGetPayment RESP.data.retentionDate | paGetPayment RESP.data.retentionDate |
| AMOUNT | FLOAT | paGetPayment RESP.data.paymentAmount |  |
| FLAG\_FINAL\_PAYMENT | CHAR | paGetPayment RESP.data.lastPayment (0-\>N,1-\>Y,true-\>Y,false-\>N) | paGetPayment RESP.data.lastPayment (0-\>N,1-\>Y,true-\>Y,false-\>N) |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |  |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** | **current\_timestamp** |
| METADATA | VARCHAR | paGetPayment RESP.data.metaData (formattare in JSON) |  |
| FK\_POSITION\_SERVICE | NUMBER | POSITION\_SERVICE.ID di riferimento |  |


## SELECT su POSITION\_TRANSFER

### POSITION\_TRANSFER (INSERT IF INSERT IN POSITION\_PAYMENT\_PLAN/UPDATE-INSERT IF UPDATE IN POSITION\_PAYMENT\_PLAN) 

```sql
SELECT C.ID 
FROM POSITION_SERVICE A
JOIN POSITION_PAYMENT_PLAN B ON (B.FK_POSITION_SERVICE=A.ID)
JOIN POSITION_TRANSFER C ON (C.FK_PAYMENT_PLAN=B.ID)
WHERE A.PA_FISCAL_CODE=<activatePaymentNoticeREQ.qrCode.fiscalCode> 
AND A.NOTICE_ID=<activatePaymentNoticeREQ.qrCode.noticeNumber>
AND B.DUE_DATE=<paGetPaymentRESP.data.dueDate> 
AND B.AMOUNT=<paGetPaymentRESP.data.paymentAmount> 
AND B.CREDITOR_REFERENCE_ID=<paGetPaymentRESP.data.creditorReferenceId>;
```

```sql
UPDATE POSITION_TRANSFER SET VALID='N' WHERE ID IN (ID ricavati prima);
```

Si inserisce una riga per ogni occorrenza di paGetPayment RESP.data.transferList.transfer{1 a 5}.

Verificare la versione della paGetPayment: se è la versione V2 salvare anche i metadata sui transfer.

|  |  |  |
| --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** |
| ID | NUMBER | SEQUENCE |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |
| CREDITOR\_REFERENCE\_ID | VARCHAR | paGetPayment RESP.data.creditorReferenceId |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |
| PA\_FISCAL\_CODE\_SECONDARY | VARCHAR | paGetPayment RESP.data.transferList.transfer{n}.fiscalCodePA |
| COMPANY\_NAME\_SECONDARY | VARCHAR | paGetPaymentV2 RESP.data.transferList.transfer{n}.companyName |
| IBAN | VARCHAR | paGetPayment RESP.data.transferList.transfer{n}.IBAN |
| AMOUNT | FLOAT | paGetPayment RESP.data.transferList.transfer{n}.transferAmount |
| REMITTANCE\_INFORMATION | VARCHAR | paGetPayment RESP.data.transferList.transfer{n}.remittanceInformation |
| TRANSFER\_CATEGORY | VARCHAR | paGetPayment RESP.data.transferList.transfer{n}.transferCategory |
| TRANSFER\_IDENTIFIER | VARCHAR | paGetPayment RESP.data.transferList.transfer{n}.idTransfer |
| VALID | CHAR | **Y** |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |
| FK\_PAYMENT\_PLAN | NUMBER | POSITION\_PAYMENT\_PLAN.ID di riferimento |
| FK\_POSITION\_PAYMENT | NUMBER | POSITION\_PAYMENT.ID di riferimento |
| METADATA | VARCHAR | paGetPayment RESP.transferList.transfer{n}.metaData (formattare in JSON)Nel caso paGetPayment V2. |

## INSERT su POSITION\_STATUS

|  |  |  |
| --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** |
| ID | NUMBER | SEQUENCE |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |
| STATUS | VARCHAR | **PAYING** |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |


## INSERT su POSITION\_STATUS\_SNAPSHOT

### POSITION\_STATUS\_SNAPSHOT (INSERT IF SERVICE DIDNT EXIST/UPDATE)

|  |  |  |  |
| --- | --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI INSERT** | **VALORI UPDATE** |
| ID | NUMBER |  |  |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |  |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |  |
| STATUS | VARCHAR | **PAYING** | **PAYING** |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |  |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** | **current\_timestamp** |
| FK\_POSITION\_SERVICE | NUMBER | POSITION\_SERVICE.ID di riferimento |  |
| ACTIVATION\_PENDING | CHAR | **N** |  |


## INSERT su POSITION\_PAYMENT

|  |  |  |  |
| --- | --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** | **NOTA** |
| ID  | NUMBER |  |  |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |  |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |  |
| CREDITOR\_REFERENCE\_ID | VARCHAR | paGetPayment RESP.data.creditorReferenceId |  |
| PAYMENT\_TOKEN | VARCHAR | **calcolato/ricavato dal nodo** |  |
| BROKER\_PA\_ID | VARCHAR | ricavato da (activatePaymentNotice.REQ.qrCode) |  |
| STATION\_ID | VARCHAR | ricavato da (activatePaymentNotice.REQ.qrCode) |  |
| STATION\_VERSION | NUMBER | ricavato da (activatePaymentNotice.REQ.qrCode) + NODO4\_CFG.STAZIONI.VERSIONE |  |
| PSP\_ID | VARCHAR | activatePaymentNotice.REQ.idPSP |  |
| BROKER\_PSP\_ID | VARCHAR | activatePaymentNotice.REQ.idBrokerPSP |  |
| CHANNEL\_ID | VARCHAR | activatePaymentNotice.REQ.idChannel |  |
| IDEMPOTENCY\_KEY | VARCHAR | activatePaymentNotice.REQ.idempotencyKey |  |
| AMOUNT | FLOAT | paGetPayment RESP.data.paymentAmount |  |
| FEE | FLOAT |  |  |
| OUTCOME | VARCHAR |  |  |
| PAYMENT\_METHOD | VARCHAR |  |  |
| PAYMENT\_CHANNEL | VARCHAR |  |  |
| TRANSFER\_DATE | TIMESTAMP |  |  |
| PAYER\_ID | NUMBER |  |  |
| APPLICATION\_DATE | TIMESTAMP |  |  |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |  |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |  |
| FK\_PAYMENT\_PLAN | NUMBER | POSITION\_PAYMENT\_PLAN.ID di riferimento |  |
| RPT\_ID | NUMBER |  |  |
| CARRELLO\_ID | NUMBER |  |  |
| PAYMENT\_TYPE | VARCHAR | **MOD3** |  |
| ORIGINAL\_PAYMENT\_TOKEN | VARCHAR |  |  |
| FLAG\_IO | CHAR | **N** |  |
| RICEVUTA\_PM | CHAR | **N** |  |
| FLAG\_ACTIVATE\_RESP\_MISSING | CHAR |  |  |
| FLAG\_PAYPAL | CHAR |  |  |
| FLAG\_STANDIN | CHAR | **Y** solo se la chiamata è stata gestita in standin**N** negli altri casi |  |


## INSERT su POSITION\_PAYMENT\_STATUS

|  |  |  |
| --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** |
| ID | NUMBER | SEQUENCE |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |
| CREDITOR\_REFERENCE\_ID | VARCHAR | paGetPayment RESP.data.creditorReferenceId |
| PAYMENT\_TOKEN | VARCHAR | **calcolato/ricavato dal nodo** |
| STATUS | VARCHAR | **PAYING** |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |

## INSERT su POSITION\_PAYMENT\_STATUS\_SNAPSHOT

|  |  |  |
| --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** |
| ID | NUMBER |  |
| PA\_FISCAL\_CODE | VARCHAR | activatePaymentNotice.REQ.qrCode.fiscalCode |
| NOTICE\_ID | VARCHAR | activatePaymentNotice.REQ.qrCode.noticeNumber |
| CREDITOR\_REFERENCE\_ID | VARCHAR | paGetPayment RESP.data.creditorReferenceId |
| PAYMENT\_TOKEN | VARCHAR | **calcolato/ricavato dal nodo** |
| STATUS | VARCHAR | **PAYING** |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |
| FK\_POSITION\_PAYMENT | NUMBER | POSITION\_PAYMENT.ID di riferimento |
| CONTA\_AVANZAMENTO\_PM | NUMBER |  |


## UPDATE su POSITION\_ACTIVATE

A seguito dell’update, il Nodo sblocca la posizione debitoria bloccata in precedenza.

|  |  |  |  |
| --- | --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI UPDATE** | **NOTA** |
| ID | NUMBER |  |  |
| PA\_FISCAL\_CODE | VARCHAR |  |  |
| NOTICE\_ID | VARCHAR |  |  |
| CREDITOR\_REFERENCE\_ID | VARCHAR | paGetPayment.RESP.data.creditorReferenceId |  |
| PSP\_ID | VARCHAR |  |  |
| IDEMPOTENCY\_KEY | VARCHAR |  |  |
| PAYMENT\_TOKEN | VARCHAR |  |  |
| TOKEN\_VALID\_FROM | TIMESTAMP | **current\_timestamp** |  |
| TOKEN\_VALID\_TO | TIMESTAMP | **current\_timestamp+activatePaymentNotice.REQ.expirationTime(ms) ALT current\_timestamp+DEFAULT** |  |
| DUE\_DATE | TIMESTAMP |  |  |
| AMOUNT | FLOAT |  |  |
| INSERTED\_TIMESTAMP | TIMESTAMP |  |  |


## nodo genera response activatePaymentNotice OK

Il Nodo genera la response OK della activatePaymentNotice a partire dalle informazioni contenute nella request e nella response della paGetPayment.

| **Campo** | **Sorgente** |
| --- | --- |
| outcome | paGetPaymentRESP.outcome |
| totalAmount | paGetPaymentRESP.paymentAmount |
| paymentDescription | paGetPaymentRESP.description |
| fiscalCodePA | activatePaymentNoticeREQ.qrCode.fiscalCode |
| companyName | paGetPaymentRESP.companyName |
| officeName | paGetPaymentRESP.officeName |
| paymentToken | generato dal Nodo |
| creditorReferenceId | paGetPaymentRESP.creditorReferenceId |
| transferList.transfer.idTransfer | paGetPaymentRESP.transferList.transfer.idTransfer |
| transferList.transfer.transferAmount | paGetPaymentRESP.transferList.transfer.transferAmount |
| transferList.transfer.fiscalCodePA | paGetPaymentRESP.transferList.transfer.fiscalCodePA |
| transferList.transfer.IBAN | paGetPaymentRESP.transferList.transfer.IBAN |
| transferList.transfer.remittanceInformation | paGetPaymentRESP.transferList.transfer.remittanceInformation |
| standin (optional) | true, solo in caso di pagamento gestito in modalità stand-in e la configurazione del canale ammetta il campo (flag standin su payment e su canale= 'Y') |


## salva response su IDEMPOTENCY\_CACHE

Il Nodo effettua una INSERT sulla tabella IDEMPOTENCY\_CACHE inserendo nel campo RESPONSE la response  della primitiva, in modo da rispondere velocemente in caso di chiamate idempotenti.


## Biz negativi

Questa primitiva può scatenare l'invio di Eventi BIZ negativi come descritto in [A.T. Eventi di business negativi](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/665026818/A.T.+Eventi+di+business+negativi)
