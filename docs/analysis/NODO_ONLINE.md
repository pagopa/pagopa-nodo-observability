# NODO\_ONLINE

Il NODO\_ONLINE contiene le entità necessarie per logica di business, ossia contiene i dati di una transazione “live”. Le tabelle sono state divise in macroaree, elencate in seguito:

·     \[DB-NON\] RPT

·     \[DB-NON\] Carrello

·     \[DB-NON\] RT

·     \[DB-NON\] Position

·     \[DB-NON\] Payment

·     \[DB-NON\] Receipt

·     \[DB-NON\] Retry

·     \[DB-NON\] Revoca

·     \[DB-NON\] Misc

# \[DB-NON\] Position


|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| POSITION\_SERVICE | Contiene le informazioni relative alla singola posizione debitoria. |
| POSITION\_STATUS | Contiene le informazioni relative allo storico degli stati della singola posizione debitoria. |
| POSITION\_STATUS\_SNAPSHOT | Contiene le informazioni relative allo stato attuale della singola posizione debitoria. |
| POSITION\_SUBJECT | Contiene le informazioni relative ai soggetti fisici e giuridici coinvolti nei pagamenti. |

 

 

#  \[DB-NON\] RPT


|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| RPT | Contiene informazioni relative alla singola richiesta di pagamento telematico |
| RPT\_ACTIVATIONS | Permette di gestire correttamente i tentativi di pagamento per cui il nodo riceve la rpt (*nodoinviarpt *request) prima della risposta di avvenuta attivazione (*activatepaymentnotice *response |
| RPT\_SOGGETTI | Contiene informazioni relative al soggetto fisico o giuridico legato alla richiesta di pagamento |
| RPT\_VERSAMENTI | Contiene informazioni relative al versamento legato alla ricevuta di pagamento telematico. |
| RPT\_VERSAMENTI\_BOLLO | Contiene informazioni relative ai versamenti effettuati per il pagamento della marca da bollo digitale. |
| RPT\_VERSAMENTI\_HIST | Funge da storico per la tabella RPT\_VERSAMENTI. |
| RPT\_XML | Contiene informazioni relative ai documenti XML delle richieste di pagamento telematico. |
| STATI\_RPT | Contiene informazioni relative allo storico degli stati delle singole richieste di pagamento telematico. |
| STATI\_RPT\_SNAPSHOT | Contiene informazioni relative alo stato della singola richiesta di pagamento telematico. |
| PM\_SESSION\_DATA | Contiene informazioni relative alla sessione di pagamento sul Payment Manager. |

 

 

# \[DB-NON\] Carrello



|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| CARRELLO | Contiene informazioni relative al singolo carrello RPT. |
| STATI\_CARRELLO | Contiene lo storico delle informazioni relative agli stati del singolo carrello RPT. |
| STATI\_CARRELLO\_SNAPSHOT | Contiene informazioni relative allo stato attuale del singolo carrello RPT. |

 

# \[DB-NON\] RT


 

|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| RT | Contiene informazioni relative alla singola ricevuta telematica. |
| RT\_VERSAMENTI | Contiene informazioni relative al versamento legato alla ricevuta telematica. |
| RT\_VERSAMENTI\_BOLLO | Contiene informazioni relative alle ricevute dei versamenti effettuati per il pagamento della marca da bollo digitale. |
| RT\_XML | Contiene informazioni relative ai documenti XML delle ricevute telematiche. |
| NOTIFICA\_RT | (Funzionalità non attiva in produzione) |
| ANAGRAFICA\_NOTIFICA\_RT | (Funzionalità non attiva in produzione) |
| NEXT\_RETRY\_NOTIFICA\_RT | (Funzionalità non attiva in produzione) |
| REGISTRO\_CHIAMATE\_NOTIFICA\_RT | (Funzionalità non attiva in produzione) |
| RETRY\_PSP\_ACK | Contiene informazioni relative all'invio del messaggio di ricezione RT al PSP da parte del Nodo. |

 

 

# \[DB-NON\] Retry

 

[\[DB-NON\] Retry](https://pagopa.atlassian.net/wiki/spaces/PAG/pages/423528585/DB-NON+Retry) funge da coda di retry per diversi servizi e contiene le seguenti tabelle:

|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| RETRY\_PA\_ATTIVA\_RPT | Funge da coda di retry per il servizio paaattivarpt. |
| RETRY\_PSP\_NOTIFICA\_CANCELLAZIONE\_RPT | Funge da coda di retry per la notifica di cancellazione della RPT |
| RETRY\_RPT | Funge da coda di retry per l’invio della RPT. |
| RETRY\_RPT\_NOTIFICA\_CANCELLAZIONE | Funge da coda di retry per la notifica al PSP della cancellazione della RPT. |
| POSITION\_RETRY\_PA\_SEND\_RT | Funge da coda di retry per la primitiva pasendrt. |
| RETRY\_PA\_INVIA\_RT | Funge da coda di retry per la primitiva paainviart. |

 

# \[DB-NON\] Receipt


 

|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| POSITION\_RECEIPT | contiene informazioni relative alla singola ricevuta. |
| POSITION\_RECEIPT\_RECIPIENT | contiene informazioni relative al destinatario della ricevuta. |
| POSITION\_RECEIPT\_RECIPIENT\_STATUS | contiene lo storico delle informazioni relative agli stati della ricevuta. |
| POSITION\_RECEIPT\_TRANSFER | viene usata come tramite tra la ricevuta e il versamento per cui è stata emessa. |
| POSITION\_RECEIPT\_XML | contiene informazioni riguardo al documento XML della ricevuta. |

 

# \[DB-NON\] Revoca


 

|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| REVOCA\_RICHIESTE | (funzionalità non attiva in produzione) |
| STORNO\_RICHIESTE | (funzionalità non attiva in produzione) |
| REVOCA\_ESITI | (funzionalità non attiva in produzione) |
| STORNO\_ESITI | (funzionalità non attiva in produzione) |

 

# \[DB-NON\] Misc



|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| CD\_INFO\_PAGAMENTO | contiene informazioni relative a pagamenti generati da appIO con configurazione PA a vecchio. |
| MESSAGGI | contiene informazioni relative a diverse tipologie di messaggi scambiati dal Nodo. |
| T\_SOGLIE\_MON | contiene le configurazioni del monitoraggio. |

 

 

 

# \[DB-NON\] Payment

  

|  |  |
| --- | --- |
| **Tabella** | **Descrizione** |
| POSITION\_PAYMENT | Contiene informazioni relative al singolo pagamento. |
| POSITION\_PAYMENT\_PLAN | Contiene informazioni relative al singolo piano di pagamento. |
| POSITION\_PAYMENT\_STATUS | Contiene lo storico delle informazioni relative agli stati del singolo pagamento. |
| POSITION\_PAYMENT\_STATUS\_SNAPSHOT | Contiene informazioni relative allo stato attuale del singolo pagamento. |
| POSITION\_TRANSFER | Contiene informazioni relative ad ogni transfer legato ad un tentativo di pagamento. |
| IDEMPOTENCY\_CACHE | Viene utilizzata come cache per permettere al Nodo di rispondere in modo veloce alle chiamate idempotenti (activatepaymentnotice, activateiopayment, sendpaymentoutcome). |
| POSITION\_ACTIVATE | Contiene informazioni relative all’attivazione di una posizione debitoria. |
| TOKEN\_UTILITY | Viene utilizzata per legare i diversi token di pagamento coinvolti nel flusso di retry. |
