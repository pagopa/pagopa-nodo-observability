# Analisi paSendRT

[Coda delle receipt da risottomettere](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/166921493/Coda+delle+receipt+da+risottomettere)

[Eliminazione poller - paSendRT](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/159875927/Eliminazione+poller+-+paSendRT)

<https://pagopa.atlassian.net/wiki/spaces/PAG/pages/132743900/FSM+Position#NEW-EC> 

[FSM Transizioni Payment-Receipt](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/136119901/FSM+Transizioni+Payment-Receipt)

[FSM Receipt](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/117342682/FSM+Receipt)


Il Nodo manda la ricevuta di pagamento nel formato receipt verso i vari destinatari enti creditori tramite la primitiva **paSendRT**.

## EndPoint

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/ec/paForNode.wsdl#L59> 

In caso l’indirizzo destinatario sia l’indirizzo dell'APIM deve essere utilizzata una sub-key da passare come header. Vd [\[WIP\] A.T. Nuova connettività: aggiunta subkey](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/712802680/WIP+A.T.+Nuova+connettivit+aggiunta+subkey)

## Parametri di Input

1. idPA
2. idBrokerPA
3. idStation
4. **receipt**
    1. receiptId
    2. noticeNumber
    3. fiscalCode
    4. outcome
    5. creditorReferenceId
    6. paymentAmount
    7. description
    8. companyName
    9. officeName (optional)
    10. debtor
        1. uniqueIdentifier
            1. entityUniqueIdentifierType
            2. entityUniqueIdentifierValue
        2. fullName
        3. streetName
        4. civicNumber
        5. postalCode
        6. city
        7. stateProvinceRegion
        8. country
        9. e-mail
    11. transferList
        1. transfer{1..5}
            1. idTransfer
            2. transferAmount
            3. fiscalCodePA
            4. IBAN
            5. remittanceInformation
            6. transferCategory
    12. idPSP
    13. pspFiscalCode (optional)
    14. pspPartitaIVA (optional)
    15. PSPCompanyName
    16. idChannel
    17. channelDescription
    18. payer (optional)
        1. uniqueIdentifier
            1. entityUniqueIdentifierType
            2. entityUniqueIdentifierValue
        2. fullName
        3. streetName
        4. civicNumber
        5. postalCode
        6. city
        7. stateProvinceRegion
        8. country
        9. e-mail
    19. paymentMethod (optional)
    20. fee (optional)
    21. paymentDateTime (optional)
    22. applicationDate (optional)
    23. transferDate (optional)
    24. metadata (optional)
5. standin (optional)

## Parametri di Output

Outcome

## Diagramma di attività


## Nodo recupera destinatari

Per prima cosa il Nodo recupera tutti i destinatari della receipt tramite filtro a DB:

`POSITION_RECEIPT_RECIPIENT.FK_POSITION_RECEIPT=POSITION_RECEIPT.ID`

dopodiché comincia il ciclo sui destinatari (PA intestataria ed eventuali PA secondarie) in modo da inoltrare ad ognuno la receipt.

**NB**: Per i pagamenti gestiti in stand-in (vd [Analisi Stand-in](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/843645183/Analisi+Stand-in) ), l'invio delle paSendRT è soggetto alla verifica della configurazione `CONFIGURATION_KEYS.invioReceiptStandin` (true = procedere con l'invio, false = generare la receipt ma non inviarla)


## Nodo invia request paSendRT

| **CAMPO** | **VALORE** | **JOIN** |
| --- | --- | --- |
| idPA | POSITION\_RECEIPT\_RECIPIENT.RECIPIENT\_PA\_FISCAL\_CODE | POSITION\_RECEIPT\_RECIPIENT.FK\_POSITION\_RECEIPT=POSITION\_RECEIPT.ID |
| idBrokerPA | POSITION\_RECEIPT\_RECIPIENT.RECIPIENT\_BROKER\_PA\_ID | POSITION\_RECEIPT\_RECIPIENT.FK\_POSITION\_RECEIPT=POSITION\_RECEIPT.ID |
| idStation | POSITION\_RECEIPT\_RECIPIENT.RECIPIENT\_STATION\_ID | POSITION\_RECEIPT\_RECIPIENT.FK\_POSITION\_RECEIPT=POSITION\_RECEIPT.ID |
| receipt.receiptId | POSITION\_RECEIPT.RECEIPT\_ID |  |
| receipt.noticeNumber | POSITION\_RECEIPT.NOTICE\_ID |  |
| receipt.fiscalCode | POSITION\_RECEIPT.PA\_FISCAL\_CODE |  |
| receipt.outcome | POSITION\_RECEIPT.OUTCOME |  |
| receipt.creditorReferenceId | POSITION\_RECEIPT.CREDITOR\_REFERENCE\_ID |  |
| receipt.paymentAmount | POSITION\_RECEIPT.PAYMENT\_AMOUNT |  |
| receipt.description | POSITION\_RECEIPT.DESCRIPTION |  |
| receipt.companyName | POSITION\_RECEIPT.COMPANY\_NAME |  |
| receipt.officeName | POSITION\_RECEIPT.OFFICE\_NAME |  |
| receipt.debtor.uniqueIdentifier.entityUniqueIdentifierType | POSITION\_SUBJECT.ENTITY\_UNIQUE\_IDENTIFIER\_TYPE | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.uniqueIdentifier.entityUniqueIdentifierValue | POSITION\_SUBJECT.ENTITY\_UNIQUE\_IDENTIFIER\_VALUE | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.fullName | POSITION\_SUBJECT.FULL\_NAME | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.streetName | POSITION\_SUBJECT.STREET\_NAME | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.civicNumber | POSITION\_SUBJECT.CIVIC\_NUMBER | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.postalCode | POSITION\_SUBJECT.POSTAL\_CODE | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.city | POSITION\_SUBJECT.CITY | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.stateProvinceRegion | POSITION\_SUBJECT.STATE\_PROVINCE\_REGION | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.country | POSITION\_SUBJECT.COUNTRY | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.debtor.e-mail | POSITION\_SUBJECT.EMAIL | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.DEBTOR\_ID |
| receipt.transferList.transfer.idTransfer | POSITION\_TRANSFER.TRANSFER\_IDENTIFIER | POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_RECEIPT = POSITION\_RECEIPT.ID AND POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_TRANSFER = POSITION\_TRANSFER.ID |
| receipt.transferList.transfer.transferAmount | POSITION\_TRANSFER.AMOUNT | POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_RECEIPT = POSITION\_RECEIPT.ID AND POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_TRANSFER = POSITION\_TRANSFER.ID |
| receipt.transferList.transfer.fiscalCodePA | POSITION\_TRANSFER.PA\_FISCAL\_CODE\_SECONDARY | POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_RECEIPT = POSITION\_RECEIPT.ID AND POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_TRANSFER = POSITION\_TRANSFER.ID |
| receipt.transferList.transfer.IBAN | POSITION\_TRANSFER.IBAN | POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_RECEIPT = POSITION\_RECEIPT.ID AND POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_TRANSFER = POSITION\_TRANSFER.ID |
| receipt.transferList.transfer.remittanceInformation | POSITION\_TRANSFER.REMITTANCE\_INFORMATION | POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_RECEIPT = POSITION\_RECEIPT.ID AND POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_TRANSFER = POSITION\_TRANSFER.ID |
| receipt.transferList.transfer.transferCategory | POSITION\_TRANSFER.TRANSFER\_CATEGORY | POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_RECEIPT = POSITION\_RECEIPT.ID AND POSITION\_RECEIPT\_TRANSFER.FK\_POSITION\_TRANSFER = POSITION\_TRANSFER.ID |
| receipt.idPSP | POSITION\_RECEIPT.PSP\_ID |  |
| receipt.pspFiscalCode | POSITION\_RECEIPT.PSP\_FISCAL\_CODE |  |
| receipt.pspPartitaIVA | POSITION\_RECEIPT.PSP\_VAT\_NUMBER |  |
| receipt.PSPCompanyName | POSITION\_RECEIPT.PSP\_COMPANY\_NAME |  |
| receipt.idChannel | POSITION\_RECEIPT.CHANNEL\_ID |  |
| receipt.channelDescription | POSITION\_RECEIPT.CHANNEL\_DESCRIPTION |  |
| receipt.payer.uniqueIdentifier.entityUniqueIdentifierType | POSITION\_SUBJECT.ENTITY\_UNIQUE\_IDENTIFIER\_TYPE | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.uniqueIdentifier.entityUniqueIdentifierValue | POSITION\_SUBJECT.ENTITY\_UNIQUE\_IDENTIFIER\_VALUE | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.fullName | POSITION\_SUBJECT.FULL\_NAME | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.streetName | POSITION\_SUBJECT.STREET\_NAME | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.civicNumber | POSITION\_SUBJECT.CIVIC\_NUMBER | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.postalCode | POSITION\_SUBJECT.POSTAL\_CODE | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.city | POSITION\_SUBJECT.CITY | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.stateProvinceRegion | POSITION\_SUBJECT.STATE\_PROVINCE\_REGION | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.country | POSITION\_SUBJECT.COUNTRY | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.payer.e-mail | POSITION\_SUBJECT.EMAIL | POSITION\_SUBJECT.ID=POSITION\_RECEIPT.PAYER\_ID |
| receipt.paymentMethod | POSITION\_RECEIPT.PAYMENT\_METHOD |  |
| receipt.fee | POSITION\_RECEIPT.FEE |  |
| receipt.paymentDateTime | POSITION\_RECEIPT.PAYMENT\_DATE\_TIME |  |
| receipt.applicationDate | POSITION\_RECEIPT.APPLICATION\_DATE |  |
| receipt.transferDate | POSITION\_RECEIPT.TRANSFER\_DATE |  |
| receipt.metadata | POSITION\_RECEIPT.METADATA |  |
| standin (optional) | true, solo se il pagamento è stato attivato in modalità stand-in e la configurazione della stazione ammette il campo (flag standin su payment e su stazione = 'Y') |  |

## UPDATE POSITION\_RECEIPT\_RECIPIENT / STATUS

A seguito dell’invio della request, viene aggiornato lo status del destinatario della receipt (UPDATE sul campo POSITION\_RECEIPT\_RECIPIENT.STATUS, INSERT sulla tabella POSITION\_RECEIPT\_RECIPIENT\_STATUS):

| **STATO DA** | **STATO A** |
| --- | --- |
| NOTICE\_GENERATED | NOTICE\_SENT |

## UPDATE POSITION\_PAYMENT\_STATUS / SNAPSHOT

Nel caso in cui il destinatario della receipt sia la PA intestataria della posizione debitoria, viene anche aggiornato lo status del payment (UPDATE sulla POSITION\_PAYMENT\_STATUS\_SNAPSHOT, INSERT sulla POSITION\_PAYMENT\_STATUS):

| **STATO DA** | **STATO A** |
| --- | --- |
| NOTICE\_GENERATED | NOTICE\_SENT |


## UPDATE POSITION\_RECEIPT\_RECIPIENT / STATUS

A seguito della chiamata, a seconda che il Nodo riceva una response o meno, viene aggiornato lo status del destinatario della receipt (UPDATE sul campo POSITION\_RECEIPT\_RECIPIENT.STATUS, INSERT sulla tabella POSITION\_RECEIPT\_RECIPIENT\_STATUS):

| **ESITO** | **STATO DA** | **STATO A** |
| --- | --- | --- |
| OK/KO | NOTICE\_SENT | NOTIFIED |
| Timeout / Errore Response / Irraggiungibile | NOTICE\_SENT | NOTICE\_PENDING |

Nel secondo caso viene iniziato un ciclo di retry sulla chiamata per ottenere una risposta dalla PA, vedi [paragrafo successivo](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/449609957/Analisi+paSendRT#INSERT-su-RETRY_PA_INVIA_RT).

## UPDATE POSITION\_STATUS / SNAPSHOT

Una volta ricevuta una response intellegibile alla chiamata per la PA intestataria, viene aggiornato lo status della posizione debitoria (UPDATE sulla POSITION\_STATUS\_SNAPSHOT, INSERT sulla POSITION\_STATUS):

| **STATO DA** | **STATO A** |
| --- | --- |
| PAID | NOTIFIED |


## INSERT su POSITION\_RETRY\_PA\_SEND\_RT

Nel caso in cui la chiamata paSendRT vada in timeout/errore response o nel caso in cui la PA risulti irraggiungibile, viene inserito un record sulla tabella POSITION\_RETRY\_PA\_SEND\_RT in modo da iniziare un loop di retry per ottenere una response valida dal destinatario:

| **CAMPO** | **VALORE** |
| --- | --- |
| ID | Generato automaticamente dal Nodo |
| PA\_FISCAL\_CODE | POSITION\_RECEIPT\_RECIPIENT.PA\_FISCAL\_CODE |
| NOTICE\_ID | POSITION\_RECEIPT\_RECIPIENT.NOTICE\_ID |
| TOKEN | POSITION\_RECEIPT\_RECIPIENT.PAYMENT\_TOKEN |
| FK\_RECIPIENT | POSITION\_RECEIPT\_RECIPIENT.ID |
| RETRY | **0** |
| INSERTED\_TIMESTAMP | Timestamp di inserimento |
| UPDATED\_TIMESTAMP | Timestamp di inserimento |


## Esiste un altro destinatario?

Se vi sono multipli destinatari della receipt, il Nodo ripete il ciclo, altrimenti prosegue con il flusso.


## UPDATE POSITION\_PAYMENT\_STATUS / SNAPSHOT

Una volta ricevuta la response della chiamata per tutti i recipient ([indipendentemente se le response siano OK/KO](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/117342682/FSM+Receipt#PAYMENT), basta che siano ricevute dal Nodo), viene aggiornato lo status del payment (UPDATE sulla POSITION\_PAYMENT\_STATUS\_SNAPSHOT, INSERT sulla POSITION\_PAYMENT\_STATUS):

| **STATO DA** | **STATO A** |
| --- | --- |
| NOTICE\_SENT | NOTIFIED |



## Schedulazione del batch

Con il task  [PAG-1703](https://pagopa.atlassian.net/browse/PAG-1703) i parametri di schedulazione del batch sono stati modificati da:

- 5 tentativi
- 1 tentativo ogni minuto

a

- 48 tentativi
- 1 tentativo all’ora
