# Analisi mod3CancelV2

**1.0 Logic Flows**

***Main Flow***

1. Flusso principale

   Il flusso inizia con la definizione dello stato del job attivando il flusso secondario **fireJobIfNotRunning**. Lo stato del job potrebbe essere:

- *JOB\_STARTED* che rappresenta che il job è in attesa di essere avviato;

> In tal caso, il flusso procede ad attivare il cuore del job (processNPayments)

O

- *JOB\_RUNNING* che rappresenta che il job è già stato avviato

> In tal caso, il flusso si conclude.

2\. Lo stato del job viene recuperato dalla tabella **SCHEDULER\_FIRE\_CHECK**.


***fireJobIfNotRunning***


***processNPayments***

1. definisce una lista **pps **recuperata da **onlineRepository**

- I filtri sono *time*, *timeLimit *(input) e (limitJobSize) (configuration)

2\. Un check viene effetuato su pps

- In caso la lista è vuota, si conlcude il flusso. 
- In caso la lista non è vuota, viene attivato il sub-flow **mod3CancelNPayments**
- Alla conclusione di mod3CancelNPayments, viene chiamto processNPayments ricorsivamente.



***mod3CancelNpayments ***

1. chiama il metodo **cancelPayments **passando I parametri 

- sessionId

> Input

- time

> Input

- pps

> definito in **processNPayments**


***cancelPayment***

1. **pp **si referisce ai ogetti della lista **pps **

- salvare le varie caratteristiche dell'entità in RE

2\. **posPayStatus **si referisce ai ogetti recuperati dalla tabella **PAYMENT\_STATUS\_SNAPSHOT **[\[DB-NON\] Payment](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/423528494/DB-NON+Payment)

3\.  Vengono controllati lo **status **del  **posPayStatus **& **paymentMethod **del **pp **

- status = UNKNOWN e paymentMethod = BPAY

> effetua findPMSessionData
> 
> chaiama **callSendPaymentResult **

- status = UNKNOWN e paymentmethod != closePAymentV2DenyListTipoVers

> chiama **callSendPaymentResult**
