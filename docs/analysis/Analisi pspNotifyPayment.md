# Analisi pspNotifyPayment

[A.T. pspNotifyPayment](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/271876323/A.T.+pspNotifyPayment)

[A.T. Processo di pagamento presso app io](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/259392067/A.T.+Processo+di+pagamento+presso+app+io)

<https://github.com/pagopa/pagopa-api/pull/190> 


Il Nodo chiama questa primitiva 

- nel flusso di pagamento presso appIO con configurazione PA NEW (nel caso PA OLD viene invocata la primitiva pspInviaCarrelloRPTCarte). La primitiva è chiamata in maniera sincrona alla nodoInoltraEsitoPagamentoCarte (nodoInoltraEsitoPagamentoPaypal nel caso di [A.T. Pagamenti con Paypal su AppIO](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/412418294/A.T.+Pagamenti+con+Paypal+su+AppIO) ), e serve a comunicare al PSP le informazioni relative al pagamento in atto.
- Nel flusso di pagamento presso appIO con BancomatPay, la chiamata è asincrona e viene scatenata dalla closePayment e l’informazione ricevuta in response viene notificata al PM tramite la primitiva sendPaymentResult.
- nel flusso di pagamento NMU la chiamata è asincrona e viene scatenata dalla closePaymentV2, quando eCommerce indica un canale con versione primitive=V1 nella request, e l’informazione ricevuta in response viene notificata al PM tramite la primitiva sendPaymentResultV2.

## Input

1. idPSP
2. idBrokerPSP
3. idChannel
4. paymentToken
5. paymentDescription
6. fiscalCodePA
7. companyName
8. officeName
9. creditorReferenceId
10. debtAmount
11. transferList
12. transfer(maxOccurs="5")
    1. idTransfer
    2. transferAmount
    3. fiscalCodePA
    4. IBAN
    5. remittanceInformation
13. creditCardPayment
    1. rrn
    2. outcomePaymentGateway
    3. totalAmount
    4. fee
    5. timestampOperation
    6. authorizationCode
    7. paymentGateway (optional)
14. paypalPayment
    1. transactionId
    2. pspTransactionId
    3. totalAmount
    4. fee
    5. timestampOperation
15. bancomatpayPayment
    1. transactionId
    2. outcomePaymentGateway
    3. totalAmount
    4. fee
    5. timestampOperation
    6. authorizationCode
    7. paymentGateway (optional)
16. additionalPaymentInformations
    1. 
        1. key
        2. value
    2. 
        1. key
        2. value
    3. …
17. standin (optional)

## Output

Outcome


## Endpoint

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/psp/pspForNode.wsdl#L39> 

In caso l’indirizzo destinatario sia l’indirizzo dell'APIM deve essere utilizzata una sub-key da passare come header. Vd [\[WIP\] A.T. Nuova connettività: aggiunta subkey](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/712802680/WIP+A.T.+Nuova+connettivit+aggiunta+subkey)



## nodo genera request pspNotifyPayment

| **Attributi xml** | **Valore** |
| --- | --- |
| 1. idPSP 2. idBrokerPSP 3. idChannel 4. paymentToken 5. paymentDescription 6. fiscalCodePA 7. companyName 8. officeName 9. creditorReferenceId 10. debtAmount 11. transferList 12. transfer(maxOccurs="5")     1. idTransfer     2. transferAmount     3. fiscalCodePA     4. IBAN     5. remittanceInformation 13. creditCardPayment     1. rrn     2. outcomePaymentGateway     3. totalAmount     4. fee     5. timestampOperation     6. authorizationCode     7. paymentGateway (optional)                                                         14. paypalPayment     1. transactionId     2. pspTransactionId     3. totalAmount     4. fee     5. timestampOperation 15. bancomatpayPayment     1. transactionId     2. outcomePaymentGateway     3. totalAmount     4. fee     5. timestampOperation     6. authorizationCode     7. paymentGateway (optional) 16. additionalPaymentInformations     1.          1. key         2. value     2.          1. key         2. value     3. … 17. standin (optional) | 1. POSITION\_PAYMENT.PSP\_ID 2. POSITION\_PAYMENT.BROKER\_PSP\_ID 3. POSITION\_PAYMENT.CHANNEL\_ID 4. POSITION\_PAYMENT.PAYMENT\_TOKEN 5. POSITION\_SERVICE.DESCRIPTION 6. POSITION\_SERVICE.PA\_FISCAL\_CODE 7. POSITION\_SERVICE.COMPANY\_NAME 8. POSITION\_SERVICE.OFFICE\_NAME 9. POSITION\_PAYMENT.CREDITOR\_REFERENCE\_ID 10. POSITION\_PAYMENT.AMOUNT 11.  12.       1. POSITION\_TRANSFER(n).TRANSFER\_IDENTIFIER     2. POSITION\_TRANSFER(n).AMOUNT     3. POSITION\_TRANSFER(n).PA\_FISCAL\_CODE\_SECONDARY     4. POSITION\_TRANSFER(n).IBAN     5. POSITION\_TRANSFER(n).REMITTANCE\_INFORMATION 13.      1. nodoInoltraEsitoPagamentoCarta.REQ.RRN/ closePaymentV2.REQ.additionalPaymentInformations.rrn     2. nodoInoltraEsitoPagamentoCarta.REQ.esitoTransazioneCarta/ closePaymentV2.additionalPaymentInformations.outcomePaymentGateway     3. nodoInoltraEsitoPagamentoCarta.REQ.importoTotalePagato/ closePaymentV2.REQ.additionalPaymentInformations.totalAmount     4. (nodoInoltraEsitoPagamentoCarta.REQ.importoTotalePagato- POSITION\_PAYMENT.AMOUNT)/ closePaymentV2.REQ.additionalPaymentInformations.fee     5. nodoInoltraEsitoPagamentoCarta.REQ.timestampOperazione/ closePaymentV2.REQ.additionalPaymentInformations.timestampOperation     6. nodoInoltraEsitoPagamentoCarta.REQ.codiceAutorizzativo/ closePaymentV2.REQ.additionalPaymentInformations.authorizationCode     7.  n.a. / \[closePaymentV2.REQ.additionalPaymentInformations.paymentGateway\] 14.      1. nodoInoltraEsitoPagamentoPayPal.REQ.idTransazione / closePaymentV2.REQ.additionalPaymentInformations.transactionId     2. nodoInoltraEsitoPagamentoPayPal.REQ.idTransazionePsp / closePaymentV2.REQ.additionalPaymentInformations.pspTransactionId     3. nodoInoltraEsitoPagamentoPayPal.REQ.importoTotalePagato / closePaymentV2.REQ.additionalPaymentInformations.totalAmount     4. (nodoInoltraEsitoPagamentoPayPal.REQ.importoTotalePagato - POSITION\_PAYMENT.AMOUNT) / closePaymentV2.REQ.additionalPaymentInformations.fee     5. nodoInoltraEsitoPagamentoPayPal.REQ.timestampOperazione / closePaymentV2.REQ.additionalPaymentInformations.timestampOperation 15.      1. closePaymentREQ.additionalPaymentInformations.transactionId / closePaymentV2.REQ.additionalPaymentInformations.transactionId     2. closePaymentREQ.additionalPaymentInformations.outcomePaymentGateway / closePaymentV2.additionalPaymentInformations.outcomePaymentGateway     3. closePaymentREQ.totalAmount / closePaymentV2.REQ.additionalPaymentInformations.totalAmount     4. closePaymentREQ.fee / closePaymentV2.REQ.additionalPaymentInformations.fee     5. closePaymentREQ.timestampOperation / closePaymentV2.REQ.additionalPaymentInformations.timestampOperation     6. closePaymentREQ.additionalPaymentInformations.authorizationCode / closePaymentV2.REQ.additionalPaymentInformations.authorizationCode     7. xxx / \[closePaymentV2.REQ.additionalPaymentInformations.paymentGateway\] 16.      1.          1. **tipoVersamento**         2. closePaymentREQ.tipoVersamento      2.          1. closePaymentREQ.additionalPaymentInformations\[n\].key         2. closePaymentREQ.additionalPaymentInformations\[n\].value     3. … 17. true, presente solo se il pagamento è stato attivato in modalità stand-in, la notify è stata scatenata da una closeV2 e la configurazione del canale ammette il campo (flag standin su payment e su canale= 'Y') |

**Caso particolare Carte con closepaymentV2**

Nel caso la primitiva venga chiamata da closePaymentV2 si procede al travaso dei dati da `closePaymentV2.REQ.additionalPaymentInformations` nelle strutture `pspNotifyPayment.REQ.creditCardPayment` / `pspNotifyPayment.REQ.paypalPayment` / `pspNotifyPayment.REQ.bancomatpayPayment`se:

- il PaymentMethod nella CPV2 è uno tra CP, PPAL e BPAY
- il canale PSP ha il flag FLAG\_TRAVASO='Y'


## UPDATE su POSITION\_PAYMENT\_STATUS/SNAPSHOT

Dopo l’invio della request.

| **STATO DA** | **STATO A** |
| --- | --- |
| PAYING | PAYMENT\_SENT |

Vedi <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/120982308/FSM+Payment#App-IO-e-new-EC---Pagamento-con-CARTE/Paypal> 


## nodo valida xml

<https://github.com/pagopa/pagopa-api/blob/1498e28a3f4d50ab2b462b12fcb33baf2558948c/psp/pspForNode.xsd#L165> 

Il Nodo effettua valutazioni sintattiche e semantiche sulla response ricevuta.

In caso di errori risponderà alla eventuale primitiva di inoltro con **KO: UNKPSP**.

In caso di NMU (quindi pspNotifyPayment scatenata dalla [Analisi closePaymentV2 \[PM/SC-\>Nodo\]](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/511705348/Analisi+closePaymentV2+PM+SC-+Nodo) ), il Nodo non avrà alcuna risposta da fornire a eCommerce, in quanto la closePaymentV2 è una primitiva asincrona.

## UPDATE su POSITION\_PAYMENT\_STATUS/SNAPSHOT

Dopo la ricezione della response, viene aggiornato lo status del payment.

| **CASO** | **STATO DA** | **STATO A** |
| --- | --- | --- |
| RESP.outcome = OK | PAYMENT\_SENT | PAYMENT\_ACCEPTED |
| RESP.outcome = KO | PAYMENT\_SENT | PAYMENT\_REFUSED |
| ERROR RESPONSE/TIMEOUT | PAYMENT\_SENT | PAYMENT\_UNKNOWN |
| PSP IRRAGIUNGIBILE | PAYMENT\_SENT | PAYMENT\_SEND\_ERROR |

Vedi <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/120982308/FSM+Payment#App-IO-e-new-EC---Pagamento-con-CARTE/Paypal> 


## Altre considerazioni su UPDATE a DB

`POSITION_STATUS/SNAPSHOT`

Non si aggiorna invece ancora lo status della posizione debitoria (POSITION\_STATUS/SNAPSHOT), per la quale si attende outcome o annullamento.

`RPT_STATI/SNAPSHOT`

In caso di pagamento BPAY/NMU con PA Old, il comportamento dovrà seguire <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/120981434/FSM+RPT#Pagamenti-BPAY-(WIP)>  

| **CASO** | **STATO DA** | **STATO A** |
| --- | --- | --- |
| RESPONSE ESITO OK | RPT\_PARCHEGGIATA\_NODO | RPT\_ACCETTATA\_PSP |
| RESPONSE ESITO KO | RPT\_PARCHEGGIATA\_NODO | RPT\_ANNULLATA\_WISP |
| ERROR RESPONSE/TIMEOUT | RPT\_PARCHEGGIATA\_NODO | Resta in RPT\_PARCHEGGIATA\_NODO in attesa di SPO+ |
| PSP IRRAGGIUNGIBILE | RPT\_PARCHEGGIATA\_NODO | RPT\_ANNULLATA\_WISP |


## INSERT in NMU\_CANCEL\_UTILITY (if needed)

In caso di timeout o errore response per una pspNotifyPayment scatenata dal flusso [closePaymentV2](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/511705348/Analisi+closePaymentV2+PM+SC-+Nodo) per PA New, quando mette il payment in stato PAYMENT\_UNKNOWN, il Nodo deve provvedere all’inserimento nella NMU\_CANCEL\_UTILITY di un record utile al set di token in esame. Vedi <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/537166077/Analisi+mod3cancelV2+per+NMU#Opzione-2---specifica-ACCETTATA>
