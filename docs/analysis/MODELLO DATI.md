# MODELLO DATI

In questa sezione vengono illustrate le principali strutture dati e le entità che compongono l’architettura del sistema pagoPa.


|  |  |
| --- | --- |
| **Entità** | **Descrizione** |
| **Richiesta di Pagamento Telematico (RPT)** | La RPT è emessa dall’Ente Creditore e definisce gli elementi necessari a caratterizzare il pagamento da effettuare; |
| **Posizione Debitoria** | Rappresenta l’entità (il servizio) per la quale l’EC vuole ricevere pagamenti tramite la piattaforma. |
| **Avviso di Pagamento** | Rappresenta la notifica (cartacea o digitale) della posizione debitoria verso il cittadino. |
| **Pagamento (Payment)** | Descrive nel dettaglio l’operazione di pagamento correlata ad un avviso e contiene informazioni di incasso e di accredito. |
| **Ricevuta (Receipt)** | Descrive l’esito di un pagamento, contiene i dettagli dell’incasso e la previsione dell’accredito, contiene al suo interno anche il riferimento all’avviso di pagamento. |
| **Flusso di Rendicontazione (FdR)** | Dettaglia il riversamento effettuato verso i conti correnti di un EC da parte di un PSP, contiene l’elenco di tutti i pagamenti |


Riferimento: <https://docs.pagopa.it/sanp/specifiche-attuative-del-nodo-dei-pagamenti-spc/modello-dati>
