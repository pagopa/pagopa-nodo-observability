# Analisi pspNotifyPaymentV2 \[Nodo\-\>PSP\]

Il Nodo chiama questa primitiva nel nuovo modello unico di pagamento. La primitiva è chiamata in maniera asincrona alla closePaymentV2, e serve a comunicare al PSP le informazioni relative al pagamento in corso.

La primitiva può essere invocata solo verso [canali PSP configurati come V2](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/527106342/A.T.+Nuove+Primitive+v2#Configurazione).

Questa versione gestisce anche la marca da bollo digitale e può inoltrarne le richieste verso il PSP.

## Input

1. idPSP
2. idBrokerPSP
3. idChannel
4. transactionId
5. totalAmount
6. fee
7. primaryCiIncurredFee (optional)
8. IdBundle (optional)
9. IdCiBundle (optional)
10. timestampOperations
11. paymentList
    1. payment (maxOccurs=5)
        1. paymentToken
        2. paymentDescription
        3. fiscalCodePA
        4. companyName
        5. officeName (optional)
        6. creditorReferenceId
        7. debtAmount
        8. transferList
            1. transfer (maxOccurs=5)
                1. idTransfer
                2. transferAmount
                3. fiscalCodePA
                4. companyName (optional)
                5. **CHOICE (IBAN/richiestaMarcaDaBollo)**
                    - **IBAN**
                    - **richiestaMarcaDaBollo**
                        - hashDocumento
                        - tipoBollo
                        - provinciaResidenza
                6. remittanceInformation
                7. metadata (optional)
                    1.  mapEntry (minOccurs=1, maxOccurs=10)
                        1. key
                        2. value
        9. metadata (optional)
            1.  mapEntry (minOccurs=1, maxOccurs=10)
                1. key
                2. value
        10. standin (optional)
12. additionalPaymentInformations
    1. mapEntry (minOccurs=1, maxOccurs=10)
        1. key
        2. value

## Output

1. outcome

 

## Endpoint

<https://github.com/pagopa/pagopa-api/blob/SANP3.1.0/wsdl/pspForNode.wsdl> 

[https://github.com/pagopa/pagopa-api/blob/SANP3.1.0/xsd/pspForNode\_2\_0\_0.xsd/#L75](https://github.com/pagopa/pagopa-api/blob/SANP3.1.0/xsd/pspForNode_2_0_0.xsd/#L75) 

In caso l’indirizzo destinatario sia l’indirizzo dell'APIM deve essere utilizzata una sub-key da passare come header. Vd [\[WIP\] A.T. Nuova connettività: aggiunta subkey](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/712802680/WIP+A.T.+Nuova+connettivit+aggiunta+subkey)




## nodo genera request pspNotifyPaymentV2

| **Attributi xml** | **Valore** |
| --- | --- |
| 1. idPSP 2. idBrokerPSP 3. idChannel 4. transactionId 5. totalAmount 6. fee 7. primaryCiIncurredFee (optional) 8. idBundle (optional) 9. idCiBundle (optional) 10. timestampOperation 11. paymentList     1. payment(maxOccurs="5")         1. paymentToken         2. paymentDescription         3. fiscalCodePA         4. companyName         5. officeName (optional)         6. creditorReferenceId         7. debtAmount         8. transferList             1. transfer(maxOccurs="5")                 1. idTransfer                 2. transferAmount                 3. fiscalCodePA                 4. companyName (optional)                 5. **CHOICE (IBAN/richiestaMarcaDaBollo)**                     - **IBAN**                     - **richiestaMarcaDaBollo**                         - hashDocumento                         - tipoBollo                         - provinciaResidenza                 6. remittanceInformation                 7. metadata (optional)         9. metadata (optional)         10. standin (optional) 12. additionalPaymentInformations (optional) | 1. closePaymentV2REQ.idPsp 2. closePaymentV2REQ.idBrokerPSP 3. closePaymentV2REQ.idChannel 4. closePaymentV2REQ.transactionId 5. closePaymentV2REQ.totalAmount 6. closePaymentV2REQ.fee 7. closePaymentV2REQ.primaryCiIncurredFee 8. closePaymentV2REQ.idBundle 9. closePaymentV2REQ.idCiBundle 10. closePaymentV2REQ.timestampOperation 11.      1.          1. closePaymentV2REQ.paymentTokens\[n\]         2. POSITION\_SERVICE.DESCRIPTION         3. POSITION\_SERVICE.PA\_FISCAL\_CODE         4. POSITION\_SERVICE.COMPANY\_NAME         5. POSITION\_SERVICE.OFFICE\_NAME         6. POSITION\_PAYMENT.CREDITOR\_REFERENCE\_ID         7. POSITION\_PAYMENT.AMOUNT         8.              1.                  1. POSITION\_TRANSFER(n).TRANSFER\_IDENTIFIER                 2. POSITION\_TRANSFER(n).AMOUNT                 3. POSITION\_TRANSFER(n).PA\_FISCAL\_CODE\_SECONDARY                 4. POSITION\_TRANSFER(n).COMPANY\_NAME\_SECONDARY                 5. **CHOICE (IBAN/richiestaMarcaDaBollo)**                     - **POSITION\_TRANSFER(n).IBAN**                     - **richiestaMarcaDaBollo**                         - POSITION\_TRANSFER.REQ\_HASH\_DOCUMENTO                         - POSITION\_TRANSFER.REQ\_TIPO\_BOLLO                         - POSITION\_TRANSFER.REQ\_PROVINCIA\_RESIDENZA                 6. POSITION\_TRANSFER(n).REMITTANCE\_INFORMATION                 7. Ricavato da POSITION\_TRANSFER(n).METADATA         9.   Ricavato da POSITION\_PAYMENT\_PLAN.METADATA         10. true, presente solo se il pagamento è stato attivato in modalità stand-in, la notifyV2 è stata scatenata da una closeV2 e la configurazione del canale ammette il campo (flag standin su payment e su canale= 'Y') 12. closePaymentV2REQ.additionalPaymentInformations     1.          1. key='tipoVersamento'         2. value=closePaymentV2REQ.paymentMethod     2. … |

 

## UPDATE su POSITION\_PAYMENT\_STATUS/SNAPSHOT

Dopo l’invio della request, viene aggiornato lo stato di tutti i payment.

| **STATO DA** | **STATO A** |
| --- | --- |
| PAYING | PAYMENT\_SENT |

Vedi <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#Payment> 

 

## nodo valida xml

[https://github.com/pagopa/pagopa-api/blob/SANP3.1.0/xsd/pspForNode\_2\_0\_0.xsd](https://github.com/pagopa/pagopa-api/blob/SANP3.1.0/xsd/pspForNode_2_0_0.xsd) 

Il Nodo effettua valutazioni sintattiche e semantiche sulla response ricevuta.

 

## UPDATE su POSITION\_PAYMENT\_STATUS/SNAPSHOT

Dopo la ricezione della response, viene aggiornato lo status di tutti i payment.

| **CASO** | **STATO DA** | **STATO A** |
| --- | --- | --- |
| RESP.outcome = OK | PAYMENT\_SENT | PAYMENT\_ACCEPTED |
| RESP.outcome = KO | PAYMENT\_SENT | PAYMENT\_REFUSED |
| ERROR RESPONSE/TIMEOUT | PAYMENT\_SENT | PAYMENT\_UNKNOWN |
| PSP IRRAGIUNGIBILE | PAYMENT\_SENT | PAYMENT\_SEND\_ERROR |

Vedi <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/532513460/WIP+FSM+modello+unico+di+pagamento#Payment> 

Non si aggiorna invece ancora lo status della posizione debitoria (POSITION\_STATUS/SNAPSHOT), per la quale si attende sendPaymentOutcome o eventuale scadenza di un token.


## INSERT in NMU\_CANCEL\_UTILITY (if needed)

In caso di timeout o errore response, quando mette il payment in stato PAYMENT\_UNKNOWN, il Nodo deve provvedere all’inserimento nella NMU\_CANCEL\_UTILITY di un record utile al set di token in esame. Vedi <https://pagopa.atlassian.net/wiki/spaces/PAG/pages/537166077/Analisi+mod3cancelV2+per+NMU#Opzione-2---specifica-ACCETTATA>
