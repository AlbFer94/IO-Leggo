# 📚 IO Leggo — Social Reading Platform

**IO Leggo** è una piattaforma web dedicata agli amanti della lettura.  
Permette di scoprire nuovi libri, salvare le proprie letture, lasciare commenti, partecipare a gruppi di lettura e condividere l’esperienza con altri utenti.

Il progetto è stato sviluppato con **Node.js + Express**, **PostgreSQL**, **EJS**, e integra servizi esterni come **Google Books API** e **SendGrid** per l’invio degli inviti.

---

##  Funzionalità principali

### Ricerca libri
- Ricerca tramite **Google Books API**
- Visualizzazione dettagli libro (titolo, autore, descrizione, thumbnail)
- Aggiunta del libro alla propria libreria personale

###  Libreria personale
- Salvataggio dei libri
- Possibilità di segnare un libro come letto
- Aggiunta di un commento personale
- Storico delle letture

### Commenti & Community
- Feed dei commenti più recenti
- Caroselli dinamici con lazy‑loading avanzato
- Sezione “Popolari nella community” basata sul numero di commenti

### Gruppi di lettura
- Creazione di gruppi legati a un libro
- Thread di discussione
- Post e risposte
- Sistema di inviti tramite email

### Inviti via email
- Invio inviti tramite **SendGrid**
- Template email personalizzato
- Token univoco per accesso alla pagina invito

### 🔐 Autenticazione
- Registrazione e login con password hashata (bcrypt)
- Sessioni gestite tramite `express-session`

---

## Tecnologie utilizzate

- **Node.js + Express**
- **PostgreSQL** (con `pg`)
- **EJS** per il rendering server-side
- **Bootstrap 5** per lo stile
- **Google Books API** per ottenere dati sui libri
- **SendGrid API** per l’invio email
- **Axios** per le richieste HTTP
- **bcrypt** per la gestione sicura delle password
- **express-session** per la gestione delle sessioni utente

---

## 📡 API utilizzate

###  Google Books API
Utilizzata per:
- Ricerca libri
- Recupero thumbnail
- Suggerimenti personalizzati basati sulle letture dell’utente

###  SendGrid Email API
Utilizzata per:
- Invio inviti personalizzati
- Gestione dei token di invito

---

## Autore

**Alberto Ferullo**  
Sviluppatore full‑stack e creatore del progetto IO Leggo.

---

## 🧩 Versione

**v1.0.0** — Prima release pubblica del progetto.

---

## 📄 Licenza

Questo progetto è rilasciato per scopi didattici e personali.
