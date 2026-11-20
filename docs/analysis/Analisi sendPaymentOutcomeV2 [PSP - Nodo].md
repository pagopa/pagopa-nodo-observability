# Analisi sendPaymentOutcomeV2 \[PSP \-\> Nodo\]

Questa primitiva viene introdotta nel flusso [Nuovo Modello Unico](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/522846291/A.T.+Nuovo+Processo+di+pagamento+attivato+presso+l+Ente+Creditore+NM1) di pagamento. Il PSP comunica l'esito del pagamento al Nodo tramite la primitiva **sendPaymentOutcomeV2**, usando i token di pagamento come identificativi. La chiamata deve essere idempotente.

Nel flusso NMU con attivazione presso l’EC o presso i touchpoints PagoPA (NM1 o [appIO](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/259392067/A.T.+Processo+di+pagamento+presso+app+io)) è accettabile solo l’outcome OK.  

## Endpoint

<https://github.com/pagopa/pagopa-api/blob/SANP3.1.0/wsdl/nodeForPsp.wsdl> 

[https://github.com/pagopa/pagopa-api/blob/7eb001c591c425cc2e1cc308d5f06178846e16a9/xsd/nodeForPsp\_2\_0\_0.xsd#L272](https://github.com/pagopa/pagopa-api/blob/7eb001c591c425cc2e1cc308d5f06178846e16a9/xsd/nodeForPsp_2_0_0.xsd#L272) 


## Input

1. idPSP
2. idBrokerPSP
3. idChannel
4. password
5. paymentTokens\[\]  (min=1, max=5)
6. outcome
7. idempotencyKey
8. details 
    1. paymentMethod
    2. paymentChannel (optional)
    3. fee
    4. primaryCiIncurredFee (optional)
    5. idBundle (optional)
    6. idCiBundle (optional)
    7. payer (optional)
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
    8. applicationDate
    9. transferDate
    10. marcheDaBollo {1..25} (optional)
        1. paymentToken
        2. idTransfer
        3. MBDAttachment


## Output

1. outcome
2. fault (solo nel caso di KO)


## Diagramma UML



## Nodo valida XML

[https://github.com/pagopa/pagopa-api/blob/7eb001c591c425cc2e1cc308d5f06178846e16a9/xsd/nodeForPsp\_2\_0\_0.xsd#L272](https://github.com/pagopa/pagopa-api/blob/7eb001c591c425cc2e1cc308d5f06178846e16a9/xsd/nodeForPsp_2_0_0.xsd#L272) 

Il Nodo effettua valutazioni sintattiche e semantiche sulla request ricevuta.

In particolare, nel caso di pagamento attivato presso l’EC o presso i touchpoints PagoPA (NM1, identificabile con POSITION\_PAYMENT.TRANSACTION\_ID popolato),  rispetto alla prima versione della primitiva va aggiunto un controllo semantico specifico sul campo REQ.fee, che deve essere uguale al valore passato al Nodo dalla closePaymentV2 e salvato su POSITION\_PAYMENT.FEE.

In caso di errori risponderà rispettivamente con i fault code **PPT\_SINTASSI\_EXTRAXSD** e **PPT\_SEMANTICA**.

In particolare, nel caso in cui riceva una chiamata con outcome KO per token con POSITION\_PAYMENT.TRANSACTION\_ID popolato (NM1) o con FLAG\_IO='Y' (appIO), il Nodo rifiuta la chiamata con errore semantico e descrizione "Outcome KO non accettabile".

Il Nodo non effettua controlli sul campo VERSIONE\_PRIMITIVE del canale. 

Come emerso in fase di test, c'è la possibilità che il PSP invochi la primitiva per un singolo token PA OLD, pur avendo ricevuto la pspNotifyPayment su un canale V1

### Nodo valida xml MDB

Qualora il PSP mandi delle marche da bollo (validazione del punto j.iii), il nodo deve validare sintatticamente gli xml contro l’xsd di Agenzia delle Entrate LINK marcaDaBollo.xsd

Se uscirà un’anomalia di validazione, il Nodo manderà un fault code **PPT\_SINTASSI\_XSD**. fault description “Errore validazione marca da bollo“.

## Gestione idempotenza

Il Nodo valuta i parametri significativi di chiamata, in questo caso la chiave di idempotenza (\<idempotencyKey\>) e l’identificativo del PSP (\<idPSP\>). 

```sql
SELECT *
FROM IDEMPOTENCY_CACHE
WHERE IDEMPOTENCY_KEY = REQ.idempotencyKey
AND PSP_ID = REQ.idPSP
```

Se i parametri sono già conosciuti e l’hash della request corrisponde a quello salvato a DB, il Nodo non procede ad alcuna modifica sui dati ma risponde in maniera cachata dal layer di idempotenza con la response salvata a seguito della prima chiamata (vedi [Idempotenza \[Design Review\]](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/159711301/Idempotenza+Design+Review) ).

Se i controlli non vanno a buon fine, il Nodo risponderà con **PPT\_ERRORE\_IDEMPOTENZA**.

## nodo verifica token

Per ogni token presente in REQ.paymentTokens\[\], il Nodo verifica dalla tabella POSITION\_ACTIVATE se esista il token ricevuto in request, filtrando per i valori di ID\_PSP e PAYMENT\_TOKEN ricevuti in request. Non verifica per ora la loro validità. Se uno o più token non vengono trovati, il Nodo risponderà alla primitiva con **PPT\_TOKEN\_SCONOSCIUTO**.

Inoltre, in caso di POSITION\_PAYMENT.TRANSACTION\_ID popolato e CLOSE\_VERSION='v2' (NM1), il Nodo verifica che i token presenti in REQ.paymentTokens\[\] siano tutti e soli quelli ricevuti nella closePaymentV2 ed inviati nella pspNotifyPaymentV2 (quindi identificati dallo stesso TRANSACTION\_ID).

```sql
--esempio
SELECT PAYMENT_TOKEN FROM POSITION_PAYMENT pp
WHERE pp.TRANSACTION_ID=(
  SELECT TRANSACTION_ID FROM POSITION_PAYMENT pp
  WHERE pp.PAYMENT_TOKEN=REQ.paymentTokens[0])
```

Se il controllo non restituisce gli stessi token inviati in request, il Nodo risponderà alla primitiva con **PPT\_TOKEN\_SCONOSCIUTO**.

In caso di token multipli e POSITION\_PAYMENT.TRANSACTION\_ID non popolato (NM3), il Nodo risponderà con l’errore **PPT\_SEMANTICA **e descrizione “Outcome non accettabile per token multipli attivati presso il PSP”

Dato l’inserimento di questa select, è da valutare l’aggiunta di un indice sul campo POSITION\_PAYMENT.TRANSACTION\_ID

## Prima di andare avanti con i controlli semantici ([PAG-2185](https://pagopa.atlassian.net/browse/PAG-2185) )

Si applica solo al caso NMU, in caso di NM3 il token non è riconducibile ad un transaction\_id.

L’introduzione dei test sulle MBD allunga potenzialmente il tempo tra arrivo della REQ e cambio degli stati dei payments, è opportuno bloccare l’annullo potenziale nel caso dei payments in stato PAYMENT\_UNKNOWN. 

Verificare se esiste una riga corrispondente ai token ricevuti nella NMU\_CANCEL\_UTILITY: 

- Se non esiste la riga , andare avanti sugli step di verifica.
- Se esiste, tentare update busy='Y' where busy is null sulla riga trovata.
    - Se l’update fallisce, uscire con errore PPT\_SEMANTICA, description “Outcome non accettabile per stato pagamento”.
    - Se l’update riesce, andare avanti sugli step di verifica.

Nel batch mod3CancelV2 va inserito il medesimo meccanismo di controllo, il batch va avanti a processare i payment identificati dalla riga NMU\_CANCEL\_UTILITY solo se è riuscito ad aggiornare il flag busy='Y' where busy='N'.

Nel batch il controllo è inserito dopo la query iniziale, appena prima di partire con la cancellazione legata al record NMU\_CANCEL\_UTILITY in corso.

## verifica esito già acquisito

Per verificare se sia già stato comunicato al Nodo un esito per il pagamento in questione, il Nodo verifica sulla tabella POSITION\_PAYMENT se per tutti i token presenti in REQ.paymentTokens\[\] sia già valorizzato il campo OUTCOME.

- Se tutti i campi risultano già valorizzati e uguali tra loro, il Nodo risponde alla primitiva con l’errore **PPT\_ESITO\_GIA\_ACQUISITO**, e nel campo fault.description della response vengono inseriti i dati precedentemente presenti a DB in formato JSON (vedi esempio seguente).

```xml
<fault>
  <faultCode>PPT_ESITO_GIA_ACQUISITO</faultCode>
  <faultString>L'esito del pagamento risulta già acquisito dal sistema pagoPA.</faultString>
  <id>NodoDeiPagamentiSPC</id>
  <description>Esito concorde: {"applicationDate":"2021-12-11","fee":2.00,"outcome":"OK","payerEntityUniqueIdentifierValue":"77777777777_01","paymentChannel":"app","paymentMethod":"creditCard","paymentToken":"88a43f044ac045f1934178602fc9e324","transferDate":"2021-12-11"}</description>
</fault>
```

- Se per uno o più pagamenti il campo risulta diverso dagli altri (perché NULL o perché discorde), il Nodo risponde alla primitiva con l’errore **PPT\_SEMANTICA** e descrizione “Esiti acquisiti parziali o discordi”.

## verifica payment

Per ogni token presente in REQ.paymentTokens\[\], il Nodo verifica la presenza del pagamento sulla tabella POSITION\_PAYMENT\_STATUS\_SNAPSHOT, tramite filtro PAYMENT\_TOKEN=REQ.paymentToken\[n\]: se almeno uno dei token non si trova in tabella, il Nodo restituisce l’errore **PPT\_PAGAMENTO\_SCONOSCIUTO**.

### Check pagamento duplicato

In caso di singolo token con POSITION\_PAYMENT.TRANSACTION\_ID non popolato e FLAG\_IO=’N' (NM3), viene fatto un check di pagamento duplicato per poter valutare se accettare l’outcome a token scaduto o meno. Il check in questione viene fatto sulla POSITION\_PAYMENT\_STATUS\_SNAPSHOT utilizzando come filtri PA\_FISCAL\_CODE e NOTICE\_ID relativi al token in esame. In caso venisse trovato un record attivo (non CANCELLED e non FAILED) con token diverso da quello di REQ.paymentTokens\[\] verrà restituita una risposta KO con faultCode **PPT\_PAGAMENTO\_DUPLICATO**.

### Check stato payment

Per ogni token presente in REQ.paymentTokens\[\], il Nodo verifica lo stato del pagamento per capire se il token sia ancora in corso di validità o meno:

- stati tutti in **CANCELLED**: i token sono scaduti, il Nodo risponderà alla primitiva con il KO **PPT\_TOKEN\_SCADUTO** 
    - caso POSITION\_PAYMENT.TRANSACTION\_ID popolato (NM1) o FLAG\_IO='Y' ([AppIO](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/259392067/A.T.+Processo+di+pagamento+presso+app+io)):  NON è accettabile l’outcome a token scaduto e NON è previsto alcun tentativo di retry
    - caso singolo token e POSITION\_PAYMENT.TRANSACTION\_ID non popolato (NM3): il Nodo gestisce il processo di [retry a token scaduto ](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/117342409/Retry+sendPaymentOutcome)

- stati coerenti:
    - tutti in **PAYMENT\_ACCEPTED **/ tutti in **PAYMENT\_UNKNOWN** (NM1 o appIO): i token sono in corso di validità, e il Nodo procede all’aggiornamento del DB e alla generazione della response positiva.
    - token in stato **PAYING **(NM3): il token è in corso di validità, il Nodo procede all’aggiornamento del DB e alla generazione della response positiva. 
- stati discordi / altri stati: il Nodo rifiuta la chiamata con errore **PPT\_SEMANTICA** con descrizione “Outcome non accettabile per stato pagamento“

## verifica stato posizioni debitorie

Per ogni token presente in REQ.paymentTokens\[\], il Nodo verifica sulla tabella POSITION\_STATUS\_SNAPSHOT lo stato della rispettiva posizione debitoria. La tabella viene filtrata per PA\_FISCAL\_CODE e NOTICE\_ID.

- Se tutti gli stati delle posizioni sono valorizzati con PAID o NOTIFIED, il Nodo restituisce l’errore **PPT\_PAGAMENTO\_DUPLICATO**.
- se almeno uno dei record trovato ha il campo ACTIVATION\_PENDING popolato a Y, il Nodo restituisce l’errore **PPT\_SEMANTICA** con descrizione “Outcome non accettabile per stato pagamento“.
- se non si trova anche una sola delle coppie PA\_FISCAL\_CODE e NOTICE\_ID relativi ai token sulla tabella, il Nodo restituisce l’errore **PPT\_PAGAMENTO\_SCONOSCIUTO**.
- se stati discordi o non accettabili: **PPT\_SEMANTICA** con descrizione “Outcome non accettabile per stato pagamento“.

## verifica marche da bollo

In caso di fallimento dei check semantici sulla MBD, il Nodo risponde KO nella response `sendPaymentOutcomeV2` faultCode **PPT\_SEMANTICA**, fault description “Check marca da bollo“.

### Check1: Match richieste registrate con i bolli mandati dal psp

Il Nodo deve verificare per ogni PAYMENT associato ai token in request, il valore di POSITION\_PAYMENT.MBD. Se 'Y':

Estrarre le richieste MBD di quel payment (POSITION\_TRANSFER where IBAN is null) →  si ottiene LISTA1: {payment\_token, transfer\_identifier}

- verificare che il PSP abbia mandato un bollo per ognuno, cioè che ogni coppia identificata nella query precedente abbia una corrispondenza nella lista SPO.REQ.details.marcheDaBollo {paymentToken;idTransfer}
- verificare anche che ogni bollo mandato nella lista del psp abbia una corrispondenza sul Nodo.

| **LISTA1 (transfer\_mbd a DB)** | **marcheDaBollo {paymentToken;idTransfer}****ricevute nella SPO** | **CHECK** |
| --- | --- | --- |
| {payment\_token1, transfer\_identifier1} |  | KO |
| {payment\_token1, transfer\_identifier2} | {paymentToken1;idTransfer2} | OK |
|  | {paymentToken1;idTransfer3} | KO |

### Check2: Verifica univocità degli IUBD (DEPRECATO)

Per questo check e i successivi, il nodo deve leggere l’xml contenuto nel campo MBDAttachment (\<XML-BOLLO\> in seguito).

Deve essere validata l’univocità (ovviamente lato Nodo), dell’IUBD mandato dal PSP, ovvero si verifica che non sia mai stato usato: 

nella tabella POSITION\_TRANSFER.IUBD

nella tabella RT\_VERSAMENTI\_BOLLO.IUBD

Il  Nodo dovrebbe fare un check anche sui dati storicizzati?

### Check3: Verifica corrispondenza hash da richiesta e da bollo (DEPRECATO)

Per ogni bollo ricevuto, si deve verificare che l’hash del documento indicato nel bollo corrisponda a quello registrato dal Nodo nella richiesta. 

Verificare POSITION\_TRANSFER.REQ\_HASH\_DOCUMENTO vs \<XML-BOLLO\>\<ImprontaDocumento\>\<digestValue\> a parità di idTransfer e paymentToken.

### Check4: Verifica corrispondenza PSP (DEPRECATO)

Deve esserci corrispondenza tra il PSP che manda la chiamata sendPaymentOutcomeV2 e il PSP indicato nel/nei bollo digitale allegato alla chiamata. 

- Occorre estrarre il CF del psp dalla configurazione del Nodo partendo dal PSP chiamante:

```
select codice_fiscale as COD_FISCALE_CHIAMANTE from nodo4_cfg.psp where id_psp=sendPaymentOutcomeV2.REQ.idPSP
```

- Verificare che : `COD_FISCALE_CHIAMANTE`=  \<XML-BOLLO\>\<PSP\>\<CodiceFiscale\>

### Check5: Verifica corrispondenza TipoBollo (DEPRECATO)

Deve esserci corrispondenza tra la richiesta bollo e il bollo generato dal PSP  a parità di idTransfer e paymentToken.

POSITION\_TRANSFER.REQ\_TIPO\_BOLLO = \<XML-BOLLO\>\<TipoBollo\>


## Update stati position e payment

- Caso Pagamento attivato presso EC o touchpoints PagoPA (NM1 o appIO): essendo accettabile solo l’esito OK, ogni posizione debitoria corrispondente ai token presenti in request passa in stato PAID, come previsto dalla [FSM](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#Position). Ogni payment corrispondente ai token presenti in request passa in stato PAID, a prescindere che si trovasse in PAYMENT\_ACCEPTED o PAYMENT\_UNKNOWN, come previsto dalla [FSM](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#Payment).
- Caso Pagamento attivato presso PSP (NM3): la posizione debitoria relativa al token in request passa in stato PAID o INSERTED in base all’outcome ricevuto in REQ.outcome come previsto dalla [FSM](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/132743900/FSM+Position). Ogni payment passa in stato PAID o FAILED in base all’outcome ricevuto, come in [FSM](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/120982308/FSM+Payment).

Per evitare concorrenza con il mod3cancel, gli update devono essere effettuati con un’unica commit.


## Insert POSITION\_SUBJECT

Se nella request della sendPaymentOutcomeV2 è presente l’oggetto \<payer\>, viene inserito un nuovo record sulla tabella POSITION\_SUBJECT.

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

Una volta superati i controlli, il Nodo aggiorna tutti i pagamenti allo stesso modo, con le informazioni contenute nella request (se presenti, salva in questa fase le informazioni sulla commissione effettiva dell’utente introdotte dalla [GEC](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/540672001/GEC+Design+Review+-+Calculator)).

|  |  |
| --- | --- |
| **COLONNA** | **VALORI** |
| ID  |  |
| PA\_FISCAL\_CODE |  |
| NOTICE\_ID |  |
| CREDITOR\_REFERENCE\_ID |  |
| PAYMENT\_TOKEN |  |
| BROKER\_PA\_ID |  |
| STATION\_ID |  |
| STATION\_VERSION |  |
| PSP\_ID |  |
| BROKER\_PSP\_ID |  |
| CHANNEL\_ID |  |
| IDEMPOTENCY\_KEY |  |
| AMOUNT |  |
| FEE | In caso di valore preesistente, non deve essere sovrascritto (valorizzato da processo precedente ie closePayment) - Se vuoto o NULL: REQ.details.fee - Se già valorizzato: non sovrascrivere |
| FEE\_PA | In caso di valore preesistente, non deve essere sovrascritto (valorizzato da processo precedente ie closePayment) - Se vuoto o NULL: REQ.details.primaryCiIncurredFee - Se già valorizzato: non sovrascrivere |
| FEE\_SPO | REQ.details.fee |
| BUNDLE\_ID | In caso di valore preesistente, non deve essere sovrascritto (valorizzato da processo precedente ie closePayment) - Se vuoto o NULL: REQ.details.idBundle - Se già valorizzato: non sovrascrivere |
| BUNDLE\_PA\_ID | In caso di valore preesistente, non deve essere sovrascritto (valorizzato da processo precedente ie closePayment) - Se vuoto o NULL: REQ.details.idCiBundle - Se già valorizzato: non sovrascrivere |
| OUTCOME | REQ.outcome |
| PAYMENT\_METHOD | REQ.paymentMethod |
| PAYMENT\_CHANNEL | REQ.paymentChannel |
| TRANSFER\_DATE | REQ.transferDate |
| PAYER\_ID | **ID inserito nella subject** |
| APPLICATION\_DATE | REQ.applicationDate |
| INSERTED\_TIMESTAMP |  |
| UPDATED\_TIMESTAMP | **current\_timestamp** |
| FK\_PAYMENT\_PLAN |  |
| RPT\_ID |  |
| PAYMENT\_TYPE |  |
| CARRELLO\_ID |  |
| ORIGINAL\_PAYMENT\_TOKEN |  |
| FLAG\_IO |  |
| RICEVUTA\_PM |  |
| FLAG\_ACTIVATE\_RESP\_MISSING |  |
| FLAG\_PAYPAL |  |
| INSERTED\_BY |  |
| UPDATED\_BY | **sendPaymentOutcomeV2** |
| TRANSACTION\_ID |  |
| CLOSE\_VERSION |  |


## insert POSITION\_TRANSFER\_MBD

Il Nodo identifica i transfer del payment che contengono delle richieste di MDB. Per ogni richiesta, si inserisce una riga nella tabella POSITION\_TRANSFER\_MBD, il valore FK\_POSITION\_TRANSFER sarà l’ID dellla POSITION\_TRANSFER che contiene la richiesta. Si valorizzano i campi con i valori della marca da bollo arrivato nella REQ SPO.

| **Nome Colonna** | **valori** |
| --- | --- |
| ID | SEQUENCE |
| FK\_POSITION\_TRANSFER | POSITION\_TRANSFER.ID che contiene la richiesta MBD |
| TIPO\_BOLLO | XML\_MBD.TipoBollo |
| TIPO\_ALLEGATO\_RICEVUTA | **BD** |
| IUBD | XML\_MBD.IUBD |
| IMPORTO | XML\_MBD.Importo |
| ORA\_ACQUISTO | XML\_MBD.OraAcquisto |
| MBD\_XML\_CONTENT | XML\_MBD intero |
| INSERTED\_TIMESTAMP | **current\_timestamp** |
| UPDATED\_TIMESTAMP | **current\_timestamp** |
| INSERTED\_BY | **sendPaymentOutcomeV2** |
| UPDATED\_BY | **sendPaymentOutcomeV2** |


## genera sendPaymentOutcomeV2 response OK

| **Campo** | **Sorgente** |
| --- | --- |
| outcome | **OK** |


## gestione IDEMPOTENCY\_CACHE e NMU\_CANCEL\_UTILITY

### INSERT

Il Nodo effettua una INSERT sulla tabella IDEMPOTENCY\_CACHE inserendo nel campo RESPONSE la response  della primitiva, in modo da rispondere velocemente in caso di chiamate idempotenti.

I campi PA\_FISCAL\_CODE, NOTICE\_ID e TOKEN della tabella IDEMPOTENCY\_CACHE vanno popolati come segue:

- caso response OK: con i dati relativi al primo token REQ.paymentTokens\[0\]
- caso response KO: PA\_FISCAL\_CODE e NOTICE\_ID saranno lasciati a NULL, TOKEN verrà popolato con il primo token REQ.paymentTokens\[0\]

### DELETE

Il Nodo elimina i record corrispondenti alle attivazioni delle posizioni debitorie sulla tabella IDEMPOTENCY\_CACHE usando come chiavi idPSP e ciascuno dei token contenuti nella request.

Il Nodo, in caso i payment ricevuti in request siano in stato PAYMENT\_UNKNOWN con CLOSE\_VERSION='v2', elimina il record relativo ai token dalla tabella [NMU\_CANCEL\_UTILITY](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/537166077/Analisi+mod3cancelV2+per+NMU).

## nodo genera receipt+

Il Nodo genera la ricevuta positiva di pagamento e l’eventuale RT (in caso di traduttore per NM3 o appIO). Vedi la [pagina relativa](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/136089568/Generazione+ricevute).

In ogni ricevuta deve essere presente la fee per intero (quindi come presente in REQ.fee) e se presenti le informazioni sulla commissione a carica della PA e sul pacchetto commissionale utilizzato.

## nodo invia receipt tramite paSendRT/paSendRTV2

Il Nodo effettua un primo tentativo di invio della ricevuta di pagamento verso le PA tramite la primitiva paSendRT/paSendRTV2. La scelta della primitiva tra paSendRT e paSendRTV2 dipende dal valore del campo VERSIONE\_PRIMITIVE configurato a DB per la singola stazione. Vedi la [pagina relativa](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/449609957/Analisi+paSendRT).

## Biz negativi

Questa primitiva può scatenare l'invio di Eventi BIZ negativi come descritto in [A.T. Eventi di business negativi](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/665026818/A.T.+Eventi+di+business+negativi)
