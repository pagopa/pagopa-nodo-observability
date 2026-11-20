# Analisi positionRetrySendPaymentResult

Quando il primo invio della sendPaymentResult non è riuscito, procede a n tentativi di invio della sendPaymentResult verso il PSP.

# **1.0 Logic Flow**

## **Main Flow**

**DESCRIZIONE:**

dopo aver controllato lo stato del job (lo stato del job viene recuperato dalla tabella **SCHEDULER\_FIRE\_CHECK**.)  tramite il sottoflusso spiegato di seguito, viene valutato:

- *JOB\_STARTED*
    - YES:  rappresenta che il job è in attesa di essere avviato;  
In tal caso, il flusso procede ad attivare il cuore del job **SendPaymentResult**  
Inputs: (sessionid, testCaseId)  
Configurations: retry  
Interfaccia con la tabella **positionRetrySendPaymentResult ** per recuperare tutte le entita che sono allineate con i filtri *retry *e *insertedTimeStamp *
    - *NO:  significa che il job non è in attesa di essere avviato e dunque il flusso si conclude*



## SOTTOFLUSSI:

### **Fire Job If not Running**

Il sottoflusso controlla semplicemente lo stato del job sulla tabella SCHEDULER\_FIRE\_CHECK


### **sendPaymentResult**


Possiamo dividere questo flusso in due parti:

1. **invocazione alla SendPaymentResult**

- Prepare la richiesta che viene effetuata verso **SendPaymentResult (primitiva **RIF: [Analisi sendPaymentResultV2 \[Nodo-\>PM\]](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/511770849/Analisi+sendPaymentResultV2+Nodo-+PM) **)**
- Un aggiornamento alla tabella **positionRetrySendPaymentResult **viene eseguito il flusso se concludo solo in caso di aver la **httpResponse **alla sendPaymentResult :  

> la caratteristica *throwable *è *defined *
> 
> payload è vuoto 
> 
> la caratteristica *statusCode non è uguale a OK* 

**2. valutazione della risposta della sendPaymentResult**


Nel caso in cui la sendPaymentResult ritorni un errore, va valutato di che natura sia, quindi:

- In caso di esito *success, *e la caratteristica *payload.esito* del *httpresponse *è *OK oppure KO*, viene cancellata la posizione nella tabella **positionRetrySendPaymentResult**  
filtri per la query sono *id*, *insertedTimeStamp*  
- In caso di esito *failure oppure di success ma con payload.esito diverso da OK o KO*, viene aggiornata la posizione nella tabella **positionRetrySendPaymnetResult**  
filtri per il query sono *id*, *insertedTimeStamp*  
L’aggiornamento coinvolge il campo *retry, updatedTimeStamp, updatedBy*

tale  comportamento vale sia nel caso di retryRecord version 1 che version 2
