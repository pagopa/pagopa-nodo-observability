# Analisi verifyPaymentNotice

<https://pagopa.github.io/pagopa-api/#operation/verifyPaymentNotice> 

[verifyPaymentNotice](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/96403881/verifyPaymentNotice)

<https://pagopa.atlassian.net/wiki/spaces/PAG/pages/132743900/FSM+Position#NEW-EC> 

Obiettivo del processo è, per il PSP, verificare la posizione debitoria prima di procedere con la richiesta di attivazione del pagamento stesso. Alcuni tra gli obiettivi del processo di verifica sono: 

- verificare la correttezza dell'idPagamento 
- verificare lo stato della posizione (pagabile/pagato/in corso) 
- ricevere i possibili pagamenti pending su quella posizione 

## Endpoint

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/nodo/nodeForPsp.wsdl#L114> 

## Input 

- idPSP
- idBrokerPSP
- idChannel
- password
- qrcode - composto dai dati ricavati dal QR-CODE.
    - fiscalCode 
    - noticeNumber - \[auxDigit\]\[segregationCode\]\[IUVBase\]\[IUVCheckDigit\]

## Output 

- outcome 
- paymentList - lista di pagamenti possibili e attivabili su quella posizione 
    - paymentOptionDescription
        - amount
        - options
        - dueDate
        - paymentNote
- paymentDescription - descrizione 
- fiscalCodePA - codice fiscale della PA 
- companyName - nome della PA 
- officeName - nome dell'ufficio (primario)
- standin (optional)

## nodo valida xml

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/nodo/nodeForPsp.xsd#L622> 

Il Nodo effettua valutazioni sintattiche e semantiche sulla request ricevuta.

In caso di errori risponderà rispettivamente con i fault code **PPT\_SINTASSI\_EXTRAXSD** e **PPT\_SEMANTICA**.

## nodo verifica eventuale posizione debitoria 

Verificare lo stato della posizione debitoria nel caso esista già. 

```sql
SELECT STATUS.STATO
FROM POSITION_SERVICE SERVICE
JOIN POSITION_STATUS_SNAPSHOT STATUS ON (STATUS.FK_POSITION_SERVICE=SERVICE.ID)
WHERE
SERVICE.NOTICE_ID=<verifyPaymentNotice REQ.noticeNumber>
AND SERVICE.PA_FISCAL_CODE=<verifyPaymentNotice REQ.fiscalCode>
```

Se la posizione è chiusa (POSITION\_STATUS\_SNAPSHOT.STATUS = **PAID** o **NOTIFIED**), il nodo risponde con KO **PPT\_PAGAMENTO\_DUPLICATO.**

## nodo gestisce paVerifyPaymentNotice

[Analisi paVerifyPaymentNotice](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/451084892/Analisi+paVerifyPaymentNotice)

## nodo genera response verifyPaymentNotice OK

| **campo** | **valori** | **note** |
| --- | --- | --- |
| outcome | **OK** |  |
| paymentList.paymentOptionDescription{n}.amount | paVerifyPaymentNotice  RESP.paymentList.paymentOptionDescription{0}. amount | da 1 a 5 |
| paymentList.paymentOptionDescription{n}.options | paVerifyPaymentNotice RESP.paymentList.paymentOptionDescription{0}. options | da 1 a 5 |
| paymentList.paymentOptionDescription{n}.dueDate (opzionale) | paVerifyPaymentNotice RESP.paymentList.paymentOptionDescription{0}. dueDate | da 1 a 5 |
| paymentList.paymentOptionDescription{n}.paymentNote( opzionale) | paVerifyPaymentNotice RESP.paymentList.paymentOptionDescription{0}. detailDescription | da 1 a 5 |
| paymentDescription | paVerifyPaymentNotice RESP.paymentDescription | da 1 a 5 |
| fiscalCodePA | paVerifyPaymentNotice RESP.fiscalCodePA |  |
| companyName | paVerifyPaymentNotice RESP.companyName |  |
| officeName | paVerifyPaymentNotice RESP.officeName |  |
| standin (optional) | true | campo presente solo in caso la paVerifyPaymentNotice sia stata gestita in modalità stand-in e la configurazione del canale ammetta il campo (flag standin  su canale= 'Y') |
