import express from "express";
import axios from "axios";
import pg from "pg";
import bcrypt from "bcrypt";
import session from "express-session";
import crypto from "crypto";
import dotenv from "dotenv";
import sgMail from "@sendgrid/mail";
import { Server } from "http";

dotenv.config();

const { Pool } = pg;

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const app = express();
const port = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});


app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.set("view engine", "ejs");

const apiKey =process.env.GOOGLE_BOOKS_API_KEY;
const queries = [ "fiction", "novel", "thriller", "romance", "fantasy", "history", "science", "bestseller", "mystery", "biography" ];

// Funzioni Helper 

function requireLogin(req, res, next) {
  if (!req.userId) {
    return res.redirect("/user?logIn=true");
  }
  next();
}

async function getUsernameById(userId) {
  const result = await pool.query(
    "SELECT username FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0]?.username || null;
}

async function getUserLibrary(userId) {
  const saved = await pool.query
(`
    SELECT sb.*, b.title, b.author, b.thumbnail, b.description
    FROM saved_books sb
    JOIN books b ON sb.book_id = b.id
    WHERE sb.user_id = $1
    ORDER BY sb.id ASC
  `, [userId]);

  return saved.rows;
}

async function getRecentComments() {
  const colors = ["#007bff", "#e83e8c", "#6f42c1", "#20c997", "#fd7e14"];

  const result = await pool.query
(`
    SELECT c.*, b.thumbnail, b.title, u.username
    FROM comments c
    JOIN books b ON c.book_id = b.id
    JOIN users u ON c.user_id = u.id
    ORDER BY c.created_at DESC
    LIMIT 10
  `);

  return result.rows.map(c => ({
    username: c.username,
    text: c.text,
    date: new Date(c.created_at).toLocaleDateString("it-IT"),
    thumbnail: c.thumbnail,
    bookId: c.book_id,
    accent: colors[Math.floor(Math.random() * colors.length)]
  }));
}

async function getRecommendedBooks(userId) {
  // Recupera gli ultimi libri letti dall’utente
  const userBooks = await pool.query(`
    SELECT b.title, b.author
    FROM saved_books sb
    JOIN books b ON sb.book_id = b.id
    WHERE sb.user_id = $1 AND sb.letto = true
    ORDER BY sb.data_lettura DESC
    LIMIT 5
  `, [userId]);

  const titles = userBooks.rows.map(b => b.title);
  const authors = userBooks.rows.map(b => b.author);

  let recommendations = [];

  async function fetchBooks(query) {
    try {
      const res = await axios.get("https://www.googleapis.com/books/v1/volumes", {
        params: { q: query, key: apiKey, maxResults: 5 }
      });
      return res.data.items || [];
    } catch {
      return [];
    }
  }

  for (const title of titles) {
    const items = await fetchBooks(`intitle:${title}`);
    recommendations.push(...items);
  }

  for (const author of authors) {
    const items = await fetchBooks(`inauthor:${author}`);
    recommendations.push(...items);
  }

  if (recommendations.length === 0) {
    const fallback = await fetchBooks("bestseller");
    recommendations.push(...fallback);
  }

  const seen = new Set();
  const filtered = recommendations.filter(book => {
    if (!book.volumeInfo?.imageLinks?.thumbnail) return false;
    if (seen.has(book.id)) return false;
    seen.add(book.id);
    return true;
  });

  return filtered.slice(0, 5);
}

// libri dalla community //
async function getCommunityPopularBooks() {
  const result = await pool.query(`
    SELECT 
      b.id,
      b.title,
      b.author,
      b.thumbnail,
      COUNT(c.id) AS comment_count
    FROM books b
    JOIN comments c ON c.book_id = b.id
    GROUP BY b.id
    ORDER BY comment_count DESC
    LIMIT 5
  `);

  return result.rows;
}

app.use((req, res, next) => {
  req.userId = req.session.userId || null;
  next();
});


app.use((req, res, next) => {
  res.locals.userId = req.userId || null;
  next();
});

app.use(async (req, res, next) => {
  if (!req.userId) {
    res.locals.avatarUrl = null;
    return next();
  }

  try {
    const result = await pool.query(
      "SELECT avatar_url FROM users WHERE id = $1",
      [req.userId]
    );

    res.locals.avatarUrl = result.rows[0]?.avatar_url || null;
    next();
  } catch (err) {
    console.error("Errore avatar:", err);
    res.locals.avatarUrl = null;
    next();
  }
});


app.get("/", async (req, res) => {
  const randomQuery = queries[Math.floor(Math.random() * queries.length)];
  
  try {
    const response = await axios.get("https://www.googleapis.com/books/v1/volumes", {
      params: { q: "subject:" + randomQuery, key: apiKey, orderBy: "newest" }
    });

    const items = response.data.items || [];
    const recentBooks = items.filter(b => {
      const year = parseInt(b.volumeInfo?.publishedDate?.substring(0, 4));
      return year >= 2018;
    });

    const bookPool = recentBooks.length > 0 ? recentBooks : items;

    function pickRandomBook() {
      const book = bookPool[Math.floor(Math.random() * bookPool.length)].volumeInfo;
      return {
        title: book.title,
        author: book.authors?.[0] || "Unknown",
        description: book.description || "",
        thumbnail: book.imageLinks?.thumbnail
      };
    }

    let book1 = null;
    let book2 = null;

if (pool.length >= 2) {
  book1 = pickRandomBook();
  book2 = pickRandomBook();
} else {
  // fallback sicuro
  book1 = {
    title: "Libro non disponibile",
    author: "",
    description: "",
    thumbnail: "/img/placeholder.png"
  };

  book2 = {
    title: "Libro non disponibile",
    author: "",
    description: "",
    thumbnail: "/img/placeholder.png"
  };
}

    const recentComments = await getRecentComments();
    let recommendedBooks = [];
    
    if (req.userId) {
  recommendedBooks = await getRecommendedBooks(req.userId);
  }

  const communityPopular = await getCommunityPopularBooks();

    res.render("index.ejs", { 
  book1, 
  book2, 
  recentComments, 
  recommendedBooks,
  communityPopular,
  userId: req.userId 
});

  } catch (err) {
    console.error(err);
    res.render("index.ejs", { 
  book1: null, 
  book2: null, 
  recentComments: [], 
  recommendedBooks: [],
  communityPopular: [],
  userId: req.userId 
});
  }
});

// recupero dati libro da click su commento user

app.get("/book/:id", requireLogin, async (req, res) => {
  const bookId = req.params.id;

  const bookResult = await pool.query("SELECT * FROM books WHERE id = $1", [bookId]);
  const book = bookResult.rows[0];

  const username = await getUsernameById(req.userId);
  const savedBooks = await getUserLibrary(req.userId);
  const recentComments = await getRecentComments();

  if (!book) {
    return res.render("libri.ejs", { 
      book: null, 
      savedBooks, 
      errorMessage: "Libro non trovato", 
      userId: req.userId,
      username,
      recentComments
    });
  }

  res.render("libri.ejs", { 
    book, 
    savedBooks, 
    userId: req.userId,
    username,
    recentComments
  });
});

//GESTIONE GRUPPI //

app.get("/groups", requireLogin, async (req, res) => {

  const inviteSent = req.query.invite === "sent";

  // 1. Gruppi + libro + creatore
const groups = await pool.query
(`
  SELECT g.*, 
         b.title AS book_title, 
         b.thumbnail AS book_thumbnail,
         u.username AS creator
  FROM groups g
  JOIN books b ON g.book_id = b.id
  JOIN users u ON g.created_by = u.id
  JOIN group_members gm ON gm.group_id = g.id
  WHERE gm.user_id = $1
  ORDER BY g.created_at DESC
`, [req.userId]);

  // 2. Thread per ogni gruppo
  const threads = await pool.query
(`
    SELECT t.*, u.username AS author
    FROM group_threads t
    JOIN users u ON t.created_by = u.id
    ORDER BY t.created_at DESC
  `);

  // 3. Messaggi per ogni thread
  const posts = await pool.query
(`
    SELECT p.*, u.username AS author
    FROM group_posts p
    JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at ASC
  `);

  // 4. Membri per ogni gruppo
  const members = await pool.query
(`
    SELECT gm.group_id, u.username
    FROM group_members gm
    JOIN users u ON gm.user_id = u.id
  `);

  // 5. Libri salvati (per il modal)
  const savedBooks = await pool.query
(`
    SELECT b.id, b.title, b.thumbnail
    FROM saved_books sb
    JOIN books b ON sb.book_id = b.id
    WHERE sb.user_id = $1
  `, [req.userId]);

  res.render("gruppi.ejs", {
    groups: groups.rows,
    threads: threads.rows,
    posts: posts.rows,
    members: members.rows,
    savedBooks: savedBooks.rows,
    userId: req.userId,
    inviteSent
  });
});

app.post("/groups/create", requireLogin, async (req, res) => {
  const { name, description, bookId, invites } = req.body;
  const userId = req.userId;

  // 1. Crea il gruppo
  const group = await pool.query
(
    `INSERT INTO groups (name, description, book_id, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [name, description, bookId, userId]
  );

  const groupId = group.rows[0].id;

  // 2. Aggiungi il creatore come membro
  await pool.query
(
    `INSERT INTO group_members (group_id, user_id)
     VALUES ($1, $2)`,
    [groupId, userId]
  );

  // 3. Gestione inviti
  if (invites && invites.trim() !== "") {
    const list = invites.split(",").map(i => i.trim());

    for (const entry of list) {
      // Cerca per email
      let user = await pool.query
(
        `SELECT id FROM users WHERE email = $1`,
        [entry]
      );

      // Se non trovato cerca per username
      if (user.rows.length === 0) {
        user = await pool.query
(
          `SELECT id FROM users WHERE username = $1`,
          [entry]
        );
      }

      // Se trovato aggiungi come membro
      if (user.rows.length > 0) {
        const invitedId = user.rows[0].id;

        await pool.query
(
          `INSERT INTO group_members (group_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [groupId, invitedId]
        );
      }
    }
  }

  res.redirect(`/groups`);
});


app.post("/thread/:threadId/post", requireLogin, async (req, res) => {
  const threadId = req.params.threadId;
  const { text } = req.body;

  await pool.query
(`
    INSERT INTO group_posts (thread_id, user_id, text)
    VALUES ($1, $2, $3)
  `, [threadId, req.userId, text]);

  const posts = await pool.query
(`
    SELECT p.*, u.username AS author
    FROM group_posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.thread_id = $1
    ORDER BY p.created_at ASC
  `, [threadId]);

  const check = await pool.query
(`
  SELECT 1
  FROM group_members gm
  JOIN group_threads t ON t.group_id = gm.group_id
  WHERE gm.user_id = $1 AND t.id = $2
`, [req.userId, threadId]);

if (check.rows.length === 0) {
  return res.status(403).send("Non sei membro di questo gruppo");
}

  res.render("partials/post-list.ejs", {
    posts: posts.rows,
    threadId,
    userId:req.userId
  });
});

app.post("/groups/:groupId/thread", requireLogin, async (req, res) => {
  const groupId = req.params.groupId;
  const { title } = req.body;
  const userId = req.userId;

  // 1. Controllo membership 
  const check = await pool.query
(`
    SELECT 1
    FROM group_members
    WHERE group_id = $1 AND user_id = $2
  `, [groupId, userId]);

  if (check.rows.length === 0) {
    return res.status(403).send("Non sei membro di questo gruppo");
  }

  // 2. Crea il thread
  await pool.query
(`
    INSERT INTO group_threads (group_id, title, created_by)
    VALUES ($1, $2, $3)
  `, [groupId, title, userId]);

  // 3. Recupera SOLO i thread di questo gruppo
  const threads = await pool.query
(`
    SELECT t.*, u.username AS author
    FROM group_threads t
    JOIN users u ON t.created_by = u.id
    WHERE t.group_id = $1
    ORDER BY t.created_at DESC
  `, [groupId]);

  // 4. Recupera i post
  const posts = await pool.query
(`
    SELECT p.*, u.username AS author
    FROM group_posts p
    JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at ASC
  `);

  res.render("partials/thread-list.ejs", {
    threads: threads.rows,
    posts: posts.rows,
    groupId,
    userId
  });
});

//cancella intero gruppo

app.post("/groups/:groupId/delete", requireLogin, async (req, res) => {
  const groupId = req.params.groupId;

  // Controllo: l’utente è il creatore del gruppo
  const check = await pool.query
(`
    SELECT 1 
    FROM groups 
    WHERE id = $1 AND created_by = $2
  `, [groupId, req.userId]);

  if (check.rows.length === 0) {
    return res.status(403).send("Non puoi cancellare questo gruppo");
  }

  try {
    await pool.query
(`
      DELETE FROM group_posts 
      WHERE thread_id IN (SELECT id FROM group_threads WHERE group_id = $1)
    `, [groupId]);

    await pool.query
(`DELETE FROM group_threads WHERE group_id = $1`, [groupId]);
    await pool.query
(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
    await pool.query
(`DELETE FROM groups WHERE id = $1`, [groupId]);

    const groups = await pool.query
(`
      SELECT g.*, b.title AS book_title, b.thumbnail AS book_thumbnail, u.username AS creator
      FROM groups g
      JOIN books b ON g.book_id = b.id
      JOIN users u ON g.created_by = u.id
      JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = $1
      ORDER BY g.created_at DESC
    `, [req.userId]);

    const threads = await pool.query
(`
      SELECT t.*, u.username AS author
      FROM group_threads t
      JOIN users u ON t.created_by = u.id
      ORDER BY t.created_at DESC
    `);

    const posts = await pool.query
(`
      SELECT p.*, u.username AS author
      FROM group_posts p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at ASC
    `);

    const members = await pool.query
(`
      SELECT gm.group_id, u.username
      FROM group_members gm
      JOIN users u ON gm.user_id = u.id
    `);

    res.render("partials/group-list.ejs", {
      groups: groups.rows,
      threads: threads.rows,
      posts: posts.rows,
      members: members.rows,
      userId: req.userId
    });

  } catch (err) {
    console.error("Errore cancellazione gruppo:", err);
    res.status(500).send("Errore nella cancellazione del gruppo");
  }
});


app.post("/invite", async (req, res) => {
  if (!req.session.userId) return res.redirect("/");

  const { friendEmail, message } = req.body;
  const userId = req.session.userId;

  // Recupera username del mittente
  const result = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
  const username = result.rows[0].username;

  // Genera token invito 
  const token = crypto.randomBytes(20).toString("hex");

  // Link invito 
  const baseUrl = process.env.BASE_URL;
  const inviteLink = `${baseUrl}/invito?from=${username}&token=${token}`;

  const email = {
    to: friendEmail,
    from: process.env.EMAIL_SENDER, 
    subject: `${username} ti ha invitato su IO Leggo!`,
    html: `
  <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">

    <h2 style="color: #4A6CF7; margin-bottom: 10px;">
      📚 Sei stato invitato su IO Leggo!
    </h2>

    <p style="font-size: 16px; line-height: 1.5;">
      <strong>${username}</strong> ti ha invitato a unirti alla community di IO Leggo,
      dove puoi scoprire nuovi libri, salvare le tue letture preferite e partecipare ai gruppi di lettura.
    </p>

    ${message ? `
      <blockquote style="margin: 20px 0; padding: 15px; background: #f7f7f7; border-left: 4px solid #4A6CF7;">
        ${message}
      </blockquote>
    ` : ""}

    <p style="font-size: 16px; line-height: 1.5;">
      Per iniziare la tua avventura, clicca sul pulsante qui sotto:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="${inviteLink}"
         style="
           background-color: #4A6CF7;
           color: white;
           padding: 14px 24px;
           text-decoration: none;
           border-radius: 6px;
           font-size: 18px;
           display: inline-block;
         ">
        ✨ Unisciti a IO Leggo
      </a>
    </div>

    <p style="font-size: 14px; color: #777; margin-top: 30px;">
      Se non hai richiesto questo invito, puoi ignorare questa email.
    </p>

    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

    <p style="font-size: 12px; color: #aaa;">
      © IO Leggo — La community per chi ama leggere.
    </p>

  </div>
`
  };

  try {
    await sgMail.send(email);
    res.redirect("/groups?invite=sent");
  } catch (err) {
    console.error("Errore invio email:", err);
    res.status(500).send("Errore nell'invio dell'email");
  }
});

app.get("/invito", (req, res) => {
  const { from, token } = req.query;

  res.render("invito.ejs", {
    from,
    token,
    userId: req.userId
  });
});

//FINE BLOCCO GRUPPI //



//GESTIONE LOGIN/REGISTRATI

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // 1. Validazione base
    if (!username || !email || !password) {
      return res.status(400).send("Tutti i campi sono obbligatori.");
    }

    // 2. Controllo se email o username esistono già
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).send("Email o username già registrati.");
    }

    // 3. Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 4. Inserimento nel DB
    const newUser = await pool.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username`,
      [username, email, passwordHash]
    );

    console.log("Session object:", req.session);

    // 5. Creazione sessione
    req.session.userId = newUser.rows[0].id;

    // 6. Redirect
    res.redirect("/");

  } catch (err) {
    console.error("Errore registrazione:", err);
    res.status(500).send("Errore del server.");
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Validazione base
    if (!email || !password) {
      return res.status(400).send("Inserisci email e password.");
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).send("Email non registrata.");
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return res.status(400).send("Questo account usa l'accesso con Google.");
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(400).send("Password errata.");
    }

    req.session.userId = user.id;

    res.redirect("/");

  } catch (err) {
    console.error("Errore login:", err);
    res.status(500).send("Errore del server.");
  }
});

app.get("/auth/google", (req,res)=>{
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const redirect=process.env.GOOGLE_REDIRECT_URI;
  const scope=["openid","email","profile"];
  try{
    const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleAuthUrl.searchParams.append("client_id", clientId);
    googleAuthUrl.searchParams.append("redirect_uri", redirect);
    googleAuthUrl.searchParams.append("response_type","code");
    googleAuthUrl.searchParams.append("scope", scope.join(" "));
    res.redirect(googleAuthUrl.toString());
  } catch(err){
    console.log(err);
  }
} );

app.get("/auth/google/callback", async (req, res) => { 
  const code=req.query.code;
  try{
   const response= await axios.post("https://oauth2.googleapis.com/token",
    {
      client_id:process.env.GOOGLE_CLIENT_ID,
      client_secret:process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:process.env.GOOGLE_REDIRECT_URI,
      grant_type:"authorization_code",
      code:code
    }
   );
   const idToken= response.data.id_token;
   const payload=JSON.parse(Buffer.from(idToken.split('.')[1],'base64').toString());

   const googleId=payload.sub;
   const email= payload.email;
   const name= payload.name;
   const avatar= payload.picture;

   let user=await pool.query("SELECT * FROM users WHERE google_id=$1",[googleId]);

   if(user.rows.length===0){
    const existing=await pool.query("SELECT * FROM users WHERE email=$1",[email]);

    if(existing.rows.length >0){
      await pool.query("UPDATE users SET google_id=$1, avatar_url=$2 WHERE id=$3",[googleId, avatar, existing.rows[0].id]);
      user=await pool.query("SELECT * FROM users WHERE id=$1",[existing.rows[0].id]);
    }else{
      user=await pool.query("INSERT INTO users (username, email, google_id, avatar_url) VALUES ($1, $2, $3, $4) RETURNING *", [name, email, googleId, avatar]);
    }
   }

   req.session.userId=user.rows[0].id;

   res.redirect("/");

  }catch(err){
    console.error("Errore OAuth:", err);
    res.redirect("/user?logIn=true");
  }
 });

app.get("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Errore durante il logout:", err);
      return res.redirect("/");
    }
    res.redirect("/");
  });
});


//FINE BLOCCO LOGIN/REGISTRATI//


app.post("/search", async (req, res) => {
  const query = req.body.searchQuery;

  if (!req.userId) {
    return res.redirect("/user?logIn=true");
  }
  
  try {
    const result = await axios.get("https://www.googleapis.com/books/v1/volumes", {
      params: { q: query, key: apiKey, maxResults: 1 }
    });

    const info = result.data.items?.[0]?.volumeInfo;

    const book = info ? {
      title: info.title,
      author: info.authors?.[0] || "Unknown",
      description: info.description || "",
      thumbnail: info.imageLinks?.smallThumbnail
    } : null;

    const savedBooks = await getUserLibrary(req.userId);
    const recentComments = await getRecentComments();
    const username = await getUsernameById(req.userId);

    res.render("libri.ejs", { 
      book, 
      savedBooks, 
      recentComments,
      userId: req.userId,
      username
    });

  } catch (err) {
    console.error(err);
    const savedBooks = await getUserLibrary(req.userId);
    const recentComments = await getRecentComments();
    const username = await getUsernameById(req.userId);

    res.render("libri.ejs", { 
      book: null, 
      savedBooks, 
      recentComments,
      errorMessage: "Errore nella ricerca", 
      userId: req.userId,
      username
    });
  }
});

app.get("/search", async (req, res) => {
  const query = req.query.q;

  if (!req.userId) return res.redirect("/user?logIn=true");

  try {
    const result = await axios.get("https://www.googleapis.com/books/v1/volumes", {
      params: { q: query, key: apiKey, maxResults: 1 }
    });

    const info = result.data.items?.[0]?.volumeInfo;

    const book = info ? {
      title: info.title,
      author: info.authors?.[0] || "Unknown",
      description: info.description || "",
      thumbnail: info.imageLinks?.smallThumbnail
    } : null;

    const savedBooks = await getUserLibrary(req.userId);
    const recentComments = await getRecentComments();
    const username = await getUsernameById(req.userId);

    res.render("libri.ejs", { 
      book, 
      savedBooks, 
      recentComments,
      userId: req.userId,
      username
    });

  } catch (err) {
    console.error(err);
    res.redirect("/user");
  }
});

app.get("/user", async (req, res) => {

  if (req.query.invito) {
    return res.render("login.ejs", { 
      userId: null,
      invito: req.query.invito,
      username: null
    });
  }

  if (!req.userId) {
    return res.render("login.ejs", { 
      userId: null,
      invito: null,
      username: null
    });
  }

  const user = await pool.query(
    "SELECT username FROM users WHERE id = $1",
    [req.userId]
  );
  const username = user.rows[0].username;

  const savedBooks = await getUserLibrary(req.userId);
  const recentComments = await getRecentComments();

  res.render("libri.ejs", { 
    savedBooks,
    recentComments,
    book: null,
    userId: req.userId,
    username
  });
});


app.post("/user", async (req, res) => {

  if (req.body.logIn) {
    const invito = req.query.invito || null;
    return res.render("login.ejs", { 
      userId: req.userId, 
      invito,
      username: null
    });
  }

  if (!req.userId) {
    return res.redirect("/user?logIn=true");
  }

  if (req.body.books) {
    return res.redirect("/user");   
  }

  if (req.body.groups) {
    return res.redirect("/groups");
  }

  const recentComments = await getRecentComments();
  return res.render("index.ejs", { 
    recentComments, 
    userId: req.userId,
    username: null
  });
});

app.post("/add", requireLogin, async (req, res) => {
  const { title, author, description, thumbnail } = req.body;

  let result = await pool.query(
    "SELECT * FROM books WHERE title = $1 AND author = $2",
    [title, author]
  );

  if (result.rows.length === 0) {
    result = await pool.query(
      "INSERT INTO books (title, author, description, thumbnail) VALUES ($1,$2,$3,$4) RETURNING *",
      [title, author, description, thumbnail]
    );
  }

  const book = result.rows[0];

  await pool.query(
    `
    INSERT INTO saved_books (user_id, book_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, book_id) DO NOTHING
    `,
    [req.userId, book.id]
  );

  const savedBooks = await getUserLibrary(req.userId);
  const recentComments = await getRecentComments();
  const username = await getUsernameById(req.userId);

  res.render("libri.ejs", { 
    book: null, 
    savedBooks, 
    recentComments,
    userId: req.userId,
    username
  });
});

app.post("/rate-book", requireLogin, async (req, res) => {
  const { bookId, commento } = req.body;

  await pool.query(
    `
    INSERT INTO comments (user_id, book_id, text)
    VALUES ($1, $2, $3)
    `,
    [req.userId, bookId, commento]
  );

  await pool.query(
    `
    UPDATE saved_books 
    SET letto = true, commento = $1, data_lettura = NOW()
    WHERE user_id = $2 AND book_id = $3
    `,
    [commento, req.userId, bookId]
  );

  const savedBooks = await getUserLibrary(req.userId);
  const recentComments = await getRecentComments();
  const username = await getUsernameById(req.userId);

  res.render("libri.ejs", { 
    book: null, 
    savedBooks, 
    recentComments,
    userId: req.userId,
    username
  });
});





    


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});