# Analisi sendPaymentOutcome

<https://pagopa.github.io/pagopa-api/#operation/sendPaymentOutcome> 

[sendPaymentOutcome](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/92472062/sendPaymentOutcome)

[FSM Position](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/132743900/FSM+Position)

[FSM Payment](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/120982308/FSM+Payment)

[FSM Transizioni Payment-Receipt](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/136119901/FSM+Transizioni+Payment-Receipt)

[sendPaymentOutcome - esito già acquisito](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/274202954/sendPaymentOutcome+-+esito+gi+acquisito)

[PAG-2258 - Gestione SPOv1 nel NMU](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/580943972/PAG-2258+-+Gestione+SPOv1+nel+NMU)

[retry: sendPaymentOutcome](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/119144710/retry+sendPaymentOutcome)

[Eliminazione poller - sendPaymentOutcome - invio receipt](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/159875222/Eliminazione+poller+-+sendPaymentOutcome+-+invio+receipt)


Il PSP comunica l'esito del pagamento al Nodo tramite la primitiva **sendPaymentOutcome**, usando il token di pagamento come identificativo del pagamento. La chiamata deve essere idempotente.  

## Endpoint

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/nodo/nodeForPsp.wsdl#L138> 


## Input

1. idPSP
2. idBrokerPSP
3. idChannel
4. password
5. paymentToken
6. outcome
7. idempotencyKey (optional)
8. details
    1. paymentMethod
    2. paymentChannel (optional)
    3. fee
    4. payer (optional)
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
    5. applicationDate
    6. transferDate

  

## Output

outcome


## Diagramma UML



## nodo valida XML

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/nodo/nodeForPsp.xsd#L769> 

Il Nodo effettua valutazioni sintattiche e semantiche sulla request ricevuta.

In caso di errori risponderà rispettivamente con i fault code **PPT\_SINTASSI\_EXTRAXSD** e **PPT\_SEMANTICA**.

## gestione idempotenza

Il Nodo valuta i parametri significativi di chiamata, in questo caso la chiave di idempotenza (\<idempotencyKey\>) e l’identificativo del PSP (\<idPSP\>). 

```sql
SELECT *
FROM IDEMPOTENCY_CACHE
WHERE IDEMPOTENCY_KEY = REQ.idempotencyKey
AND PSP_ID = REQ.idPSP
```

Se i parametri sono già conosciuti, il Nodo non procede ad alcuna modifica sui dati ma risponde in maniera cachata dal layer di idempotenza con la response salvata a seguito della prima chiamata (vedi [Idempotenza \[Design Review\]](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/159711301/Idempotenza+Design+Review) ).

Se i controlli non vanno a buon fine, il Nodo risponderà con **PPT\_ERRORE\_IDEMPOTENZA**.

## nodo verifica token

Il Nodo verifica dalla tabella POSITION\_ACTIVATE se esista il token ricevuto in request, filtrando per i valori di ID\_PSP e PAYMENT\_TOKEN ricevuti in request. Non verifica per ora la sua validità.

Se non viene trovato alcun record, il Nodo risponderà alla primitiva con **PPT\_TOKEN\_SCONOSCIUTO**.

Inoltre, in caso di POSITION\_PAYMENT.TRANSACTION\_ID popolato e CLOSE\_VERSION='v2' (NM1), il Nodo verifica che il token presente in REQ.paymentToken sia l’unico ricevuto nella closePaymentV2 ed inviato nella pspNotifyPayment (quindi che sia l’unico token associato allo stesso TRANSACTION\_ID).

In caso fossero presenti altri token associati al medesimo POSITION\_PAYMENT.TRANSACTION\_ID, il Nodo risponderà con l’errore **PPT\_SEMANTICA **e descrizione “Outcome non accettabile per token multipli”.

## verifica esito già acquisito

Per verificare se sia già stato comunicato al Nodo un esito per il pagamento in questione, il Nodo verifica sulla tabella POSITION\_PAYMENT se sia già valorizzato il campo OUTCOME.

Se il campo è valorizzato il Nodo risponde alla primitiva con l’errore **PPT\_ESITO\_GIA\_ACQUISITO**, e nel campo fault.description della response vengono inseriti i dati precedentemente presenti a DB in formato JSON (vedi esempio seguente).

```xml
<fault>
  <faultCode>PPT_ESITO_GIA_ACQUISITO</faultCode>
  <faultString>L'esito del pagamento risulta già acquisito dal sistema pagoPA.</faultString>
  <id>NodoDeiPagamentiSPC</id>
  <description>Esito concorde: {"applicationDate":"2021-12-11","fee":2.00,"outcome":"OK","payerEntityUniqueIdentifierValue":"77777777777_01","paymentChannel":"app","paymentMethod":"creditCard","paymentToken":"88a43f044ac045f1934178602fc9e324","transferDate":"2021-12-11"}</description>
</fault>
```


## nodo verifica posizione debitoria

Il Nodo verifica sulla tabella POSITION\_STATUS\_SNAPSHOT lo stato della posizione debitoria. La tabella viene filtrata per PA\_FISCAL\_CODE e NOTICE\_ID (presi dalla POSITION\_ACTIVATE).

Se lo status della posizione è PAID o NOTIFIED, questa è già stata pagata e quindi il Nodo restituisce l’errore **PPT\_PAGAMENTO\_DUPLICATO**. 

Altrimenti, se il record trovato ha il campo ACTIVATION\_PENDING popolato a Y, il Nodo restituisce l’errore **PPT\_SEMANTICA**. 

Se invece non si trova alcun record sulla tabella, il Nodo restituisce l’errore **PPT\_PAGAMENTO\_SCONOSCIUTO**.

## prima verifica payment

Il Nodo verifica la presenza del pagamento sulla tabella POSITION\_PAYMENT\_STATUS\_SNAPSHOT, filtrando per PA\_FISCAL\_CODE e CREDITOR\_REFERENCE\_ID (salvati dalla tabella POSITION\_ACTIVATE).

Viene fatto un primo filtro per ppss.PAYMENT\_TOKEN=sendPaymentOutcomeREQ.paymentToken: se non si trova alcun record sulla tabella, il Nodo restituisce l’errore **PPT\_PAGAMENTO\_SCONOSCIUTO**.

Viene poi fatto un secondo controllo, richiedendo che il campo TOKEN sia diverso da quello ricevuto in request. Se viene trovato un record, il Nodo restituisce l’errore **PPT\_PAGAMENTO\_DUPLICATO**.

Infine, viene controllato il campo STATUS del record: se questo è FAILED, anche in questo caso il Nodo restituisce l’errore **PPT\_PAGAMENTO\_DUPLICATO**.

## seconda verifica payment

Il Nodo verifica lo stato del pagamento per capire se il token sia ancora in corso di validità o meno. Nel caso sia scaduto, il pagamento si trova in status CANCELLED. Altrimenti si trova in status PAYING.

- status CANCELLED: il token è scaduto, il Nodo risponderà alla primitiva con il KO **PPT\_TOKEN\_SCADUTO**, (vedi [Retry sendPaymentOutcome](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/117342409/Retry+sendPaymentOutcome) );
- status PAYING: il token è in corso di validità, e il Nodo procede all’aggiornamento del DB e alla generazione della response positiva.
- status PAYMENT\_UNKNOWN o PAYMENT\_ACCEPTED: in caso di Pagamenti non NM3 (PPAL, appIO  nuovo, NMU ecc), il token è in corso di validità e il Nodo procede all’aggiornamento del DB e alla generazione della response positiva.

## Gestione tabella NMU\_CANCEL\_UTILITY

Il comportamento della sendPaymentOutcome deve rispecchiare quello della sendPaymentOutcomeV2 descritto in <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/534609989/Analisi+sendPaymentOutcomeV2+PSP+-+Nodo#Prima-di-andare-avanti-con-i-controlli-semantici-(%5BinlineCard%5D-)>  


## Update POSITION\_STATUS e POSITION\_STATUS\_SNAPSHOT

| **OUTCOME** | **STATUS** |
| --- | --- |
| OK | PAYING --\>PAID |
| KO | PAYING --\>INSERTED |


## Update POSITION\_PAYMENT\_STATUS e POSITION\_PAYMENT\_STATUS\_SNAPSHOT

| **OUTCOME** | **STATUS** |
| --- | --- |
| OK | PAYING --\>PAID |
| KO | PAYING --\>FAILED |


Il cambio di stato a seguito della ricezione dell’esito del pagamento è diverso nel caso di pagamento presso app IO, come riportato in [https://pagopa.atlassian.net/wiki/spaces/PAG/pages/451346445/Analisi+pspNotifyPayment#UPDATE-su-POSITION\_PAYMENT\_STATUS%2FSNAPSHOT.1](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/451346445/Analisi+pspNotifyPayment#UPDATE-su-POSITION_PAYMENT_STATUS%2FSNAPSHOT.1) (vedere <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/120982308/FSM+Payment#New-EC>  e <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/120982308/FSM+Payment#App-IO-e-new-EC---Pagamento-con-CARTE%2FPaypal> per le casistiche complete).

## Insert POSITION\_SUBJECT

Se nella request della sendPaymentOutcome è presente l’oggetto \<payer\>, viene inserito un nuovo record sulla tabella POSITION\_SUBJECT.

|  |  |  |
| --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** |
| ID | NUMBER | SEQUENCE |
| SUBJECT\_TYPE | VARCHAR | **PAYER** |
| ENTITY\_UNIQUE\_IDENTIFIER\_TYPE | VARCHAR | REQ.payer.uniqueIdentifier.entityUniqueIdentifierType |
| ENTITY\_UNIQUE\_IDENTIFIER\_VALUE | VARCHAR | REQ.payer.uniqueIdentifier.entityUniqueIdentifierValue |
| FULL\_NAME | VARCHAR | REQ.payer.fullName |
| STREET\_NAME | VARCHAR | REQ.payer.streetName |
| CIVIC\_NUMBER | VARCHAR | REQ.payer.civicNumber |
| POSTAL\_CODE | VARCHAR | REQ.payer.postalCode |
| CITY | VARCHAR | REQ.payer.city |
| STATE\_PROVINCE\_REGION | VARCHAR | REQ.payer.stateProvinceRegion |
| COUNTRY | VARCHAR | REQ.country |
| EMAIL | VARCHAR | REQ.e-mail |
| INSERTED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |


## Update POSITION\_PAYMENT

Una volta superati i controlli, il Nodo aggiorna il pagamento a DB con le informazioni contenute nella request della sendPaymentOutcome.

|  |  |  |
| --- | --- | --- |
| **COLONNA** | **TIPO** | **VALORI** |
| ID  | NUMBER |  |
| PA\_FISCAL\_CODE | VARCHAR |  |
| NOTICE\_ID | VARCHAR |  |
| CREDITOR\_REFERENCE\_ID | VARCHAR |  |
| PAYMENT\_TOKEN | VARCHAR |  |
| BROKER\_PA\_ID | VARCHAR |  |
| STATION\_ID | VARCHAR |  |
| STATION\_VERSION | NUMBER |  |
| PSP\_ID | VARCHAR |  |
| BROKER\_PSP\_ID | VARCHAR |  |
| CHANNEL\_ID | VARCHAR |  |
| IDEMPOTENCY\_KEY | VARCHAR |  |
| AMOUNT | FLOAT |  |
| FEE | FLOAT | In caso di valore preesistente, non deve essere sovrascritto (valorizzato da processo precedente ie closePayment) - Se vuoto o NULL: REQ.fee - Se già valorizzato: non sovrascrivere |
| FEE\_PA |  |  |
| FEE\_SPO |  | REQ.fee |
| OUTCOME | VARCHAR | REQ.outcome |
| PAYMENT\_METHOD | VARCHAR | REQ.paymentMethod |
| PAYMENT\_CHANNEL | VARCHAR | REQ.paymentChannel |
| TRANSFER\_DATE | TIMESTAMP | REQ.transferDate |
| PAYER\_ID | NUMBER | **ID inserito nella subject** |
| APPLICATION\_DATE | TIMESTAMP | REQ.applicationDate |
| INSERTED\_TIMESTAMP | TIMESTAMP |  |
| INSERTED\_BY | VARCHAR |  |
| UPDATED\_TIMESTAMP | TIMESTAMP | **current\_timestamp** |
| UPDATED\_BY | VARCHAR | **sendPaymentOutcome** |
| FK\_PAYMENT\_PLAN | NUMBER |  |
| RPT\_ID | NUMBER |  |


## genera sendPaymentOutcome response OK

| **Campo** | **Sorgente** |
| --- | --- |
| outcome | **OK** |



## elimina attivazione su IDEMPOTENCY\_CACHE

Il Nodo elimina il record corrispondente all’attivazione della posizione debitoria sulla tabella IDEMPOTENCY\_CACHE usando come chiavi il idPSP e la idempotencyKey contenuti nella request della sendPaymentOutcome.


## verifica outcome

Il Nodo verifica il valore di sendPaymentOutcomeREQ.outcome:

Se il valore è **OK**, procederà alla generazione e invio della ricevuta di pagamento.

Se il valore è **KO**, il Nodo non genera ricevute.

## nodo genera receipt+

Il Nodo genera la ricevuta positiva di pagamento.

Vedi la [pagina relativa](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/136089568/Generazione+ricevute).


## nodo invia receipt tramite paSendRT/paSendRTV2

Il Nodo effettua un primo tentativo di invio della ricevuta di pagamento verso le PA tramite la primitiva paSendRT/paSendRTV2. La scelta della primitiva tra paSendRT e paSendRTV2 dipende dal valore del campo VERSIONE\_PRIMITIVE configurato a DB per la singola stazione. Vedi la [pagina relativa](#).


## salva response su IDEMPOTENCY\_CACHE

Il Nodo effettua una INSERT sulla tabella IDEMPOTENCY\_CACHE inserendo nel campo RESPONSE la response  della primitiva, in modo da rispondere velocemente in caso di chiamate idempotenti.


## Biz negativi

Questa primitiva può scatenare l'invio di Eventi BIZ negativi come descritto in [A.T. Eventi di business negativi](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/665026818/A.T.+Eventi+di+business+negativi)
