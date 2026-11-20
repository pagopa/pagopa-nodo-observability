# Analisi closePaymentV2 \[PM/SC\-\>Nodo\]

Il Payment Manager comunica l’esito del pagamento al Nodo tramite la primitiva *closePayment-v2*, utilizzando i token di pagamento come identificativi delle transazioni.

## Input

1. paymentTokens
2. outcome
3. idPSP
4. idBrokerPSP
5. idChannel
6. paymentMethod
7. transactionId
8. totalAmount
9. fee
10. primaryCiIncurredFee
11. idBundle
12. idCiBundle
13. timestampOperation
14. additionalPaymentInformations
    1. key1
    2. …
    3. key9
15. transactionDetails (ex additionalPMInfo)

## Output

1. outcome
2. description (solo in caso di KO)

## Diagramma UML


#### Path

`POST v2/closepayment[?queryString]`

### Request e response

```
{
    "paymentTokens": [
		"51e59d71d0b049d18cef5de5dea4223c",
		"51e59d71d0c049d17cef5fe5dea7143c",
		"51e59271d0b049d28cef5ab5dea3243c",
		"51e59d71d0d049d48cef5de5dea6143c"
    ],
    "outcome": "OK",
    "idPSP": "CIPBITMM",
    "idBrokerPSP": "13212880160",
    "idChannel": "13212880160_02",
    "paymentMethod" : "QUALSIASICOSAPAY",
    "transactionId": "99910087308786",
    "totalAmount": 51.00,
    "fee": 1.00,
    "primaryCiIncurredFee": 1.00,
    "idBundle":"0bf0c282-3054-11ed-af20-acde48001122",
    "idCiBundle":"0bf0c35e-3054-11ed-af20-acde48001122",
    "timestampOperation": "2033-04-23T18:25:43Z",	
	"additionalPaymentInformations" : {
		"key1": "value1",
		"key2": "value2",
		...
		"key9": "value9"
    },
	"transactionDetails" : {
     "user": { -> at this time only guest user
			"notificationEmail" :"john.doe@mail.it"
			},
     "paymentAuthorizationRequest" : {
      "authOutcome": "OK"
      "requestId": "77e1c83b-7bb0-437b-bc50-a7a58e5660ac"
      "correlationId": "f864d987-3ae2-44a3-bdcb-075554495841"
      "authCode": "99"
      "paymentMethodType": "CP" -> PPAL | PPAY | ... 
      "details" : {  -> l'oggetto dipende dal paymentMethodType, ad esempio con carte potrebbe essere 
        "blurredNumber" : "****2534",
        "holder" :"M** GA****DI "
        "circuit": "VISA "
        }
      }
      "wallet" : {} -> for future needs, to be defined
    }
}
```

dove:

- **paymentTokens **è un array composto da un minimo di 1 a un massimo di 5 elementi, contenente il/i token di pagamento staccato/i dal Nodo a seguito della activatePaymentNotice
- **outcome **è l’esito del pagamento; valori possibili: \[OK,KO\]
- **idPSP **è il codice identificativo del PSP scelto per il riversamento
- **idBrokerPSP** è il codice identificativo dell’intermediario del PSP
- **idChannel **è il codice identificativo del canale del PSP usato per il pagamento
- **paymentMethod **è la tipologia di versamento, gli strumenti abilitati alla versione corrente della closePayment saranno censiti in configurazione
- **transactionId **è l’identificativo univoco della transazione condiviso tra eCommerce e Nodo
- **totalAmount** è l’importo totale pagato dal cittadino (somma algebrica tra importo e commissione a carico del cittadino, sono escluse eventuali fee di cui si fa carico l’EC)
- **fee **è l’ammonto della commissione
- **primaryCiIncurredFee **è l’ammonto della commissione a carico PA nel bundle scelto da GEC (optional)
- **idBundle **è il bundle scelto da GEC  (optional)
- **idCiBundle **è il bundle PA scelto da GEC  (optional)
- **timestampOperation **è il timestamp del pagamento
- **additionalPaymentInformations **è una struttura che contiene i metadata di ogni singolo strumento di pagamento, dove sia le **key **che i **value **sono stringhe, fino ad un massimo di 9 occorrenze.
- ** transactionDetails (ex additionalPMInfo) **è una struttura contenente dati relativi all’utente e alla transazione ma non utili al Nodo. Dovranno successivamente essere inviati tramite l’evento Biz di pagamento.

L’informazione contenuta nelle `transactionDetails`non viene validata né sintatticamente né semanticamente dal Nodo.

L’informazione contenuta nelle `additionalPaymentInformations` non viene validata semanticamente dal Nodo, TRANNE NEL CASO:

- paymentMethod uno tra ‘CP', ‘BPAY’ e 'PPAL’
- versione primitive sul canale del PSP='V1'
- flag FLAG\_TRAVASO sul canale del PSP='Y'

Se il Nodo riceve multiple coppie con stessa key, queste vengono unite in un’unica coppia con value uguale all’ultima ricevuta.

L’**obbligatorietà** dei campi in request dipende dalla valorizzazione del campo `outcome`:

- nel caso **OK**, tutti i campi sono mandatori, tranne:
    -  i contenuti di `transactionDetails` che non vengono valutati, tranne casistiche particolari descritte nel paragrafo validazione request.
    - La struttura `transactionDetails` è opzionale.
    - i campi GEC (optional): primaryCiIncurredFee, idBundle, idCiBundle
- nel caso **KO**, solo l’array `paymentTokens` e il campo `outcome` sono mandatori, gli altri sono facoltativi.

 La response alla *closePaymentV2* da parte del Nodo è puramente informativa:

- caso OK:

```
{"outcome": "OK"}
```

- caso errore:

```
{"outcome": "KO",
 "description": "***********"
}
```

| **HTTP STATUS CODE** | **CONTENT** |
| --- | --- |
| 404 | NOT FOUND |
| 400 | BAD REQUEST |
| 422 | UNPROCESSABLE ENTITY |

Le descrizioni degli errori seguono quanto presente nella pagina seguente: [Schema response closePaymentV2](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/531628175/Schema+response+closePaymentV2)

In particolare non viene accettata la chiamata se almeno un token è scaduto; in caso avvenisse, questa verrebbe rifiutata con “Unacceptable outcome when token has expired“, a prescindere dall’esito comunicato.

### Validazione Request

Va eseguita la validazione sintattica e semantica della request:

- Gli elementi dell’array `paymentTokens` devono essere al massimo 5 e tutti popolati con token noti al Nodo ed in corso di validità.
- il campo `outcome`deve essere popolato con "OK" o "KO";
- i campi `idPSP` , `idBrokerPSP`, `idChannel` e `paymentMethod` devono identificare PSP, intermediario e canale noti e abilitati, inoltre `idChannel` deve avere il MODELLO\_PAGAMENTO su CANALI\_NODO configurato come “IMMEDIATO” o “IMMEDIATO\_MULTIBENEFICIARIO”;
- il campo `tipoVersamento` viene validato :
    - viene controllato che esista l’associazione canale-tipoVersamento su CFG.CANALE\_TIPO\_VERSAMENTO;

Non esiste più il controllo del tipo versamento nella lista di esclusione `closePaymentV2DenyListTipoVersamento` configurata a DB. Tutti i tipi versamento sono accettabili, poiché la configurazione del canale indicato in input sia congruente con quel tipo versamento.

- deve essere eseguito un controllo sugli importi dei campi `totalAmount` e `fee` rispetto all'importo aggiornato ricevuto dall'EC in fase di attivazione. In particolare, 
    - nel caso PA NEW la somma delle POSITION\_PAYMENT.AMOUNT (una riga per ogni token) deve essere uguale alla differenza (totalAmount - fee).
    - nel caso PA OLD la differenza (totalAmount - fee) deve essere uguale a RPT.SOMMA\_VERSAMENTI con RPT.ID=POSITION\_PAYMENT.RPT\_ID (in questo caso può essere presente un solo token).

In caso fallisse questo controllo la chiamata viene rifiutata con errore 400 Bad Request con descrizione “Mismatched amount”.

Essendo responsabilità del eCommerce invocare la primitiva una sola volta, non vengono eseguiti lock a DB sui record riguardanti la chiamata in corso. è responsabilità del eCommerce anche non invocare più di una closePayment (a prescindere dalla versione) per lo stesso token.

#### Verifica additionalPaymentInformations 

Questi controlli sono da eseguire SOLTANTO nelle seguenti casistiche:

- paymentMethod in ('CP',‘PPAL’,'BPAY')
- versione primitive sul canale del PSP='V1'
- FLAG\_TRAVASO sul canale del PSP='Y'

La validazione si baserà solo sulla presenza e la correttezza sintattica dei campi, nessun controllo semantico. Infatti, è responsabilità di eCommerce popolare correttamente i campi di questa struttura.

##### Controllo obbligatorietà campi e valori

##### Caso Carte - CP

Verificare che la lista key/value contenga almeno una occorrenza delle seguenti chiavi:

- rrn
- outcomePaymentGateway
- totalAmount
- fee
- timestampOperation
- authorizationCode

Verificare se la lista key/value contenga eventualmente una occorrenza della seguente chiave:

- paymentGateway

##### Caso PayPal - PPAL

Verificare che la lista key/value contenga almeno una occorrenza delle seguenti chiavi:

- transactionId
- pspTransactionId
- totalAmount
- fee
- timestampOperation

##### Caso BancomatPay - BPAY

Verificare che la lista key/value contenga almeno una occorrenza delle seguenti chiavi:

- transactionId
- outcomePaymentGateway
- totalAmount
- fee
- timestampOperation
- authorizationCode

Verificare se la lista key/value contenga eventualmente una occorrenza della seguente chiave:

- PaymentGateway

##### In tutti i casi - CP, PPAL, BPAY

Eventuali campi aggiuntivi verranno ignorati dal Nodo.

Le chiavi sono da considerarsi case-sensitive e i valori devono essere passati come stringhe contenenti i valori nel formato dettato dall’XSD della pspNotifyPayment.

Verificare che i valori associati siano valorizzati con il tipo desiderato. 

##### Controllo numerosità campi 

→ Non è fattibile controllare il numero di occorrenze delle chiavi, il Nodo utilizzerà l’ultima occorrenza del campo per costruire la chiamata pspNotifyPayment. 

##### Errore nel caso fallisca il controllo additionalPaymentInformation

Il Nodo manda 400 Bad Request "description": "Invalid additionalPaymentInformations".


### Gestione idempotenza

Il Nodo, dopo la validazione sintattica della chiamata, valuta i parametri significativi di chiamata, in questo caso la chiave di idempotenza (\<transactionId\>) e l’identificativo del PSP (AGID\_01) per la primitiva.

```
SELECT *
FROM IDEMPOTENCY_CACHE
WHERE IDEMPOTENCY_KEY = REQ.transactionId
AND PSP_ID = 'AGID_01' and primitiva='closePaymentV2'
```

Se i parametri sono già conosciuti e l’hash della request corrisponde a quello salvato a DB, il Nodo non procede ad alcuna modifica sui dati ma risponde in maniera cachata dal layer di idempotenza con la response salvata a seguito della prima chiamata.

Se i controlli non vanno a buon fine, il Nodo risponderà con **PPT\_ERRORE\_IDEMPOTENZA**.


### Esito già acquisito?

Il Nodo valuta se ha già ricevuto una chiamata dal eCommerce per ogni token di pagamento indicato in request. 

Si verifica** l’eventuale esito OK** già acquisito. 

- Si verifica la valorizzazione del flag POSITION\_PAYMENT.CLOSE\_VERSION. Se il campo è popolato la chiamata viene rifiutata con errore 422 “Outcome already acquired”, in quanto questo campo viene popolato solo in caso di chiamata closePayment (sia V1 che V2) OK gestita correttamente, e non è quindi necessario controllare lo stato.

Verificare che lo stato snapshot non sia PAYING/CANCELLED non basta, in quanto lo stato CANCELLED potrebbe corrispondere ad un annullo per token scaduto dopo il primo arrivo dell’outcome OK.

Con lo spostamento traduttore, che sia PA NEW o PA OLD il payment esiste; caso PA OLD non ha più senso ragionare sulla RPT, si va direttamente sul payment.

- ~~Caso token unico su PA OLD: il check viene lasciato allo stato della RPT. In caso di stato diverso da RPT\_PARCHEGGIATA\_NODO non è possibile accettare la closePaymentV2 ma non c'è la certezza che lo stato attuale sia dovuto a una precedente closePaymentV2. Per evitare query a vuoto nella maggioranza dei casi, si sceglie di restituire l’errore generico 404 “The indicated payment does not exist”~~

 Non si verifica l’esito concorde o discorde con la prima chiamata.

### Check canale

Il Nodo verifica la configurazione del canale PSP arrivato in request (CANALI\_NODO.VERSIONE\_PRIMITIVE):

- Se il canale è V1 e si ricevono più token → viene restituito l'errore “Wrong channel version”
- Se il canale è V1 con FLAG\_IO='N' e si riceve un solo token → viene restituito l'errore "Invalid payment type"
- Se il canale è V1 con FLAG\_IO='Y' e si riceve un solo token → si utilizza la pspNotifyPayment V1
- Se il canale è V2 → si utilizza la pspNotifyPayment V2 (indipendentemente dal numero di token ricevuti)

### Controllo versione PA

Il Nodo verifica la versione della stazione PA associata al token (STATION\_VERSION sul PAYMENT). Caso PA OLD (version=1) è accettabile un unico token.

I PSP, a prescindere dalla versione primitive configurata sul canale, possono gestire sia pagamenti PA NEW che PA OLD. Esiste solo la restrizione sul numero di token, i PSP in V1 non possono gestire le transazioni multi-token. (vedere punto precedente Check canale).

### Token conosciuto?

Il Nodo valuta se i token di pagamento indicati in request siano conosciuti, altrimenti rifiuta la chiamata con l’errore adeguato (“Unknown token“).

Nel caso uno o più token risultino sconosciuti, tutti i token vengono annullati e la chiamata terminata.

### Token valido?

Il Nodo valuta se i token di pagamento indicati in request siano in corso di validità, altrimenti rifiuta la chiamata con l’errore 400 Bad Request e descrizione "Unacceptable outcome when token has expired".

Si valuta lo stato dei PAYMENT identificati dai token ricevuti in request, tabella POSITION\_PAYMENT\_STATUS\_SNAPSHOT.

Nel caso uno o più token risultino scaduti, tutti i token vengono annullati e la chiamata terminata.

Nel caso uno o più token non fossero scaduti ma avessero una stato diverso da quelli accettati (PAYING, …) dalla closePaymentV2, il Nodo risponderà 400 Bad Request e descrizione "Invalid token".

Caso PA OLD

Il caso si reperisce dal valore POSITION\_PAYMENT.STATION\_VERSION=1.

La closePaymentV2 OK/KO è accettabile soltanto se la RPT è già arrivata sul Nodo e cioè se lo stato del PAYMENT è PAYING\_RPT. 

Nel caso la RPT non fosse arrivata (stato PAYING):

- il Nodo annulla il pagamento
- il Nodo manda un errore 422 nella response closePaymentV2 [Schema response closePaymentV2](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/531628175/Schema+response+closePaymentV2#Errori-semantici)

"outcome": "KO", "description": "Node did not receive RPT yet"

### Esito KO?

In caso tutti i token risultino conosciuti e validi e REQ.outcome='KO', il Nodo dovrà procedere all’annullamento di tutti i token.

### Check di configurazione specifico MBD (solo caso esito OK)

Il Nodo verifica il valore di POSITION\_PAYMENT.MBD, se 'Y' si effettua il seguente controllo:

- CANALI\_NODO.VERSIONE\_PRIMITIVE deve essere 2 (questo il Nodo l’ha già controllato nel check canale in precedenza)
- PSP e CANALE devono avere il flag bollo: PSP.MARCA\_BOLLO\_DIGITALE='Y' e CANALI\_NODO.MARCA\_BOLLO\_DIGITALE='Y'

Caso contrario, il Nodo risponde KO ad ecommerce. “Invalid PSP/Canale for MBD“

### Annullo dei token

I token devono essere annullati nei seguenti casi:

- ricezione di un token sconosciuto: in tal caso devono essere annullati anche i restanti token conosciuti e non scaduti
- ricezione di un token scaduto: in tal caso devono essere annullati anche i restanti token non scaduti
- ricezione di un token PA OLD in assenza della RPT (stato PAYMENT=PAYING)
- REQ.outcome='KO': in tal caso tutti i token devono essere annullati se conosciuti e non scaduti

Annullare un token significa:

1. aggiornare lo stato del corrispettivo payment in CANCELLED
2. aggiornare lo stato della corrispettiva posizione debitoria in INSERTED
3. aggiornare il campo POSITION\_ACTIVATE.TOKEN\_VALID\_TO con il timestamp attuale
4. (solo PA OLD) aggiornare lo stato della corrispettiva RPT in RPT\_ANNULLATA\_WISP

### Generazione e invio RT-

Nel caso di outcome KO su unico token con PA OLD, il Nodo a seguito dell’annullo passa alla generazione della RT- (vedi [pagina relativa](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/136089568/Generazione+ricevute)) e al primo tentativo di [invio ](<https://pagopa.atlassian.net/wiki/spaces/PAG/pages/517603987/A.T.+Invio+istantaneo+delle+RT#Dettaglio-invio-delle-RT-(comune-a-tutte-le-primitive-e-batch)>)verso la PA intestataria.

### Salvataggio dati a DB

#### Update dati PM

Le informazioni ricevute da eCommerce devono essere salvate sul Nodo, così come già avviene per le altre primitive di inoltro esito.

In base al numero di token ricevuti, potrebbe essere necessario effettuare il salvataggio dei dati su più PAYMENT; l’eventuale salvataggio su una RPT resta invece unico.

Per mantenere l’indipendenza del flusso dal metodo di pagamento scelto dall’utente, i dati non vengono più salvati nella tabella PM\_SESSION\_DATA, ma viene introdotta la tabella NODO\_ONLINE.PM\_METADATA, strutturata come segue:

| **CAMPO** | **TIPO** |
| --- | --- |
| ID | NUMBER |
| TRANSACTION\_ID | VARCHAR2(50) |
| KEY | VARCHAR2(140) |
| VALUE | VARCHAR2(140) |
| INSERTED\_TIMESTAMP | TIMESTAMP |
| UPDATED\_TIMESTAMP | TIMESTAMP |
| INSERTED\_BY | VARCHAR2(100) |
| UPDATED\_BY | VARCHAR2(100) |

dove:

- **ID** è l’identificativo univoco incrementale della riga;
- **TRANSACTION\_ID** è l'identificativo univoco della transazione condiviso tra PM e Nodo;
- **KEY **è il nome della proprietà della transazione;
- **VALUE **è il valore della proprietà della transazione;
- **INSERTED\_TIMESTAMP **è il timestamp di ricezione della chiamata;
- **UPDATED\_TIMESTAMP **è il timestamp di aggiornamento del record in tabella;
- **INSERTED\_BY **è l’attore responsabile dell’inserimento del record in tabella;
- **UPDATED\_BY** è l’attore responsabile dell’aggiornamento del record in tabella;

All’arrivo della closePaymentV2 OK, a seguito della validazione sintattica e semantica della request, vengono salvati i seguenti dati:

| **CAMPO** | **TIPO** |
| --- | --- |
| ID | Generato automaticamente dal Nodo |
| TRANSACTION\_ID | REQ.transactionId |
| KEY | Vedi seguito |
| VALUE | Vedi seguito |
| INSERTED\_TIMESTAMP | Timestamp attuale |
| UPDATED\_TIMESTAMP | Timestamp attuale |

Il salvataggio dei dati implica diversi tipi di record:

- per ogni elemento REQ.paymentTokens\[n\] viene aggiunto un record “Token”;
- per l’elemento REQ.paymentMethod viene aggiunto un record “Tipo versamento”
- per l’eventuale queryString presente in request viene aggiunto un record di tipo “QUERYSTRING”
- per ogni elemento della struttura REQ.additionalPaymentInformations (che possono essere al massimo nove) viene aggiunto un record chiave-valore.

| **KEY** | **VALUE** |
| --- | --- |
| Token | PA OLD: RPT.ID\_SESSIONEPA NEW: REQ.paymentTokens\[n\] |
| Tipo versamento | REQ.paymentMethod |
| QUERYSTRING | queryString completa come ricevuta in request (in caso la lunghezza fosse superiore, devono essere memorizzati solo i primi 140 caratteri = size colonna VALUE). |
| REQ.additionalPaymentInformations\[n\].key | REQ.additionalPaymentInformations\[n\].value |

Nel caso di closePayment KO o di closePayment a token scaduto, le informazioni NON vengono salvate in tabella.

#### Update importi

L’informazioni sulle commissioni di pagamento ricevute da eComm vanno salvate su tutti i payment nel campo POSITION\_PAYMENT.FEE con la seguente logica.

Il campo va popolato con il valore REQ.fee in ogni payment corrispondente ai token presenti in request.

Questo implica una duplicazione dell’informazione nel caso siano presenti più token in request, e potrebbe avere impatti sulla raccolta dati sulle commissioni lato Operations, ma è possibile evitare il problema tramite un GROUP BY transactionId.

#### Update stati

Per gli aggiornamenti degli stati fare riferimento alle seguenti pagine:

[\[WIP\] FSM modello unico di pagamento](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#Payment)

[\[WIP\] FSM modello unico di pagamento](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#Position)

[\[WIP\] FSM modello unico di pagamento](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#RPT)

In base alla versione della PA, potrebbe essere necessario effettuare l’aggiornamento dei dati su PAYMENT\_POSITION oppure su PAYMENT\_POSITION e RPT.

#### Update dati aggiuntivi

Per salvare a DB i dati aggiuntivi da mandare nell’evento Biz, è necessario aggiungere alla tabella NODO\_ONLINE.POSITION\_PAYMENT una colonna BLOB ad hoc:

`POSITION_PAYMENT`

| **CAMPO** | **TIPO** |
| --- | --- |
| PM\_INFO | BLOB |

La colonna in questione va popolata come in tabella.

| **CAMPO** | **TIPO** |
| --- | --- |
| PM\_INFO | REQ.transactionDetails (ex REQ.additionalPMInfo) |

#### Update dati PSP

Anche riguardo ai dati del PSP, nel caso di outcome OK, in caso di PA NEW bisogna aggiornare solo la POSITION\_PAYMENT, mentre nel caso PA OLD vanno aggiornate entrambe le tabelle POSITION\_PAYMENT e RPT.

Nel caso outcome KO, eCommerce non comunica nulla riguardo al PSP.

`POSITION_PAYMENT`

| **CAMPO POSITION\_PAYMENT** | **VALORE** |
| --- | --- |
| PAYMENT\_METHOD | REQ.paymentMethod |
| PSP\_ID | REQ.idPSP |
| BROKER\_PSP\_ID | REQ.idBrokerPSP |
| CHANNEL\_ID | REQ.idChannel |
| PAYMENT\_CHANNEL | **WISP** |
| FLAG\_PAYPAL | **N** |
| RICEVUTA\_PM | **Y** |
| TRANSACTION\_ID | REQ.transactionId |
| CLOSE\_VERSION | **v2** |
| FEE | REQ.fee |
| FEE\_PA | REQ.primaryCiIncurredFee |
| BUNDLE\_ID | REQ.idBundle |
| BUNDLE\_PA\_ID | REQ.idCiBundle |

`RPT`

| **CAMPO RPT** | **VALORE** |
| --- | --- |
| TIPO\_VERSAMENTO | REQ.paymentMethod |
| PSP | REQ.idPSP |
| INTERMEDIARIOPSP | REQ.idBrokerPSP |
| CANALE | REQ.idChannel |

`POSITION_ACTIVATE` viene aggiornata con il PSP selezionato dall’utente per il pagamento, che va a sostituire il PSP fittizio salvato a DB:

| **CAMPO POSITION\_ACTIVATE** | **VALORE** |
| --- | --- |
| PSP\_ID | REQ.idPSP |


#### Update scadenza token

Sempre nella tabella `POSITION_ACTIVATE` va aggiornata la durata dei token (campo `TOKEN_VALID_TO`) a seconda dell'esito contenuto in request:

| **ESITO** | **VALORE** |
| --- | --- |
| OK | CURRENT\_TIMESTAMP+**default\_durata\_estensione\_token\_IO** |
| KO | CURRENT\_TIMESTAMP |

I token correlati hanno la stessa data scadenza dopo l’estensione della durata. 

La durata dei token NON va prolungata nel caso in cui cui la closePaymentV2 OK request arrivi a token scaduto: in quel caso il campo non viene aggiornato.

### Salvataggio log su Registro Eventi

Per la chiamata closePaymentV2 è previsto il salvataggio dei seguenti log su RE:

- log di request e response, secondo la modalità già presente per le altre primitive, anche nel caso di retry inattesi. Nel caso di chiamate con multipli token, per i record di interfaccia viene usato il primo token dell’array (paymentTokens\[0\]).
- log dei eventuali cambi di stato:
    - payment\_PAYMENT\_RESERVED
    - payment\_CANCELLED
    - position\_INSERTED

Nei record di cambio stato, che sono uno per payment, viene invece usato l’elemento paymentTokens\[n\] corrispondente al payment.

I campi riportati nella tabella seguente sono mandatori. Le informazioni assenti in request vanno recuperate tramite JOIN POSITION\_PAYMENT pp ON pp.PAYMENT\_TOKEN=REQ.paymentTokens\[0\].

| **CAMPI OBBLIGATORI** | **VALORE REQ/RESP** | **VALORE CAMBIO STATO** |
| --- | --- | --- |
| IDENTIFICATIVO\_DOMINIO | pp.PA\_FISCAL\_CODE | pp.PA\_FISCAL\_CODE |
| IDENTIFICATIVO\_UNIVOCO\_VERSAMENTO | pp.CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID |
| CODICE\_CONTESTO\_PAGAMENTO | REQ.paymentTokens\[0\] | REQ.paymentTokens\[n\] |
| IDENTIFICATIVO\_PRESTATORE\_SERVIZI\_PAGAMENTO | REQ.idPSP | REQ.idPSP |
| COMPONENTE | **FESP** | **FESP** |
| CATEGORIA\_EVENTO | **INTERFACCIA** | **INTERNO** |
| TIPO\_EVENTO | **closePayment-v2** | **closePayment-v2** |
| SOTTO\_TIPO\_EVENTO | **REQ/RESP** | **INTERN** |
| IDENTIFICATIVO\_STAZIONE\_INTERMEDIARIO\_PA | pp.STATION\_ID | pp.STATION\_ID |
| CANALE\_PAGAMENTO | REQ.idChannel | REQ.idChannel |
| BUSINESS\_PROCESS | **closePayment-v2** | **closePayment-v2** |
| NOTICE\_ID | pp.NOTICE\_ID | pp.NOTICE\_ID |
| CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID | pp.CREDITOR\_REFERENCE\_ID |
| PAYMENT\_TOKEN | REQ.paymentTokens\[0\] | REQ.paymentTokens\[n\] |
| ID\_SESSIONE\_ORIGINALE | - PA OLD: ID\_SESSIONE della RPT - PA NEW: REQ.paymentTokens\[0\] | - PA OLD: ID\_SESSIONE della RPT - PA NEW: REQ.paymentTokens\[n\] |

Anche i campi non riportati in tabella vanno valorizzati dove possibile, secondo la logica già presente per le altre primitive (es. IDENTIFICATIVO\_FRUITORE/EROGATORE, ESITO, ID\_SESSION, STATUS, PAYLOAD, etc…)

In caso fosse presente una `queryString` in request, l'intera `queryString` va scritta su RE nel campo `INFO` (NB: rimane il vincolo sui 140 caratteri come per PM\_METADATA).


## Gestione IDEMPOTENCY\_CACHE

### INSERT

Il Nodo effettua una INSERT sulla tabella IDEMPOTENCY\_CACHE inserendo nel campo RESPONSE la response della primitiva, in modo da poter rispondere velocemente in caso di chiamate idempotenti.

| **Colonna** | **Valore** |
| --- | --- |
| id | nextVal sequence |
| primitiva | closePaymentV2 |
| psp\_id | AGID\_01 |
| pa\_fiscal\_code | POSITION\_PAYMENT.PA\_FISCAL\_CODE relativo a REQ.tokens\[0\] |
| notice\_id | POSITION\_PAYMENT.NOTICE\_ID relativo a REQ.tokens\[0\] |
| idempotency\_key | REQ.transactionId |
| token | REQ.tokens\[0\] |
| valid\_to | configuration\_keys.\[idempotency.closeV2.duration.days\] → **NB**: default per la insert nella configuration\_keys = 1 |
| hash\_request | hash del body della request |
| response | RESP.boby |
| inserted\_timestamp | SYSTIMESTAMP |
| updated\_timestamp | SYSTIMESTAMP |
| inserted\_by | closePayment-v2 |
| updated\_by | closePayment-v2 |


### DELETE

Non è prevista l’eliminazione on event dei record dentro la tabella IDEMPOTENCY\_CACHE per la primitiva in oggetto. L’eliminazione avverrà con lo svecchiamento del DB.

## Biz negativi

Questa primitiva può scatenare l'invio di Eventi BIZ negativi come descritto in [A.T. Eventi di business negativi](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/665026818/A.T.+Eventi+di+business+negativi)
