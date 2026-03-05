import path from 'path';
import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import passport from './auth';
import type { UserRecord } from './auth';
import db from './db';
import bcrypt from 'bcrypt';

const SQLiteStore = SQLiteStoreFactory(session);
const app = express();
const PORT = Number(process.env.PORT) || 4174;

type ProgressField = 'a11_progress' | 'a12_progress' | 'a21_progress' | 'a22_progress' | 'b11_progress' | 'b12_progress';

type LevelDefinition = {
  code: string;
  title: string;
  field: ProgressField;
  summary: string;
};

const levelDefinitions: LevelDefinition[] = [
  { code: 'A1.1', title: 'Grundlagen', field: 'a11_progress', summary: 'Alphabet, Grüßen, Zahlen und einfache Sätze.' },
  { code: 'A1.2', title: 'Alltag', field: 'a12_progress', summary: 'Familie, Einkaufen, Uhrzeiten und Routinen.' },
  { code: 'A2.1', title: 'Ausdruck erweitern', field: 'a21_progress', summary: 'Vergangenheit, Freizeit und Stadtleben.' },
  { code: 'A2.2', title: 'Selbstständig sprechen', field: 'a22_progress', summary: 'Gesundheit, Reisen, Arbeitssituationen.' },
  { code: 'B1.1', title: 'Kompetent berichten', field: 'b11_progress', summary: 'Meinungen begründen, Nachrichten verstehen.' },
  { code: 'B1.2', title: 'Sicher kommunizieren', field: 'b12_progress', summary: 'Komplexere Texte, Vorbereitung auf Zertifikate.' },
];

const wordStatsByLevelStmt = db.prepare(`SELECT LOWER(word_level) as lvl, COUNT(*) as total, SUM(CASE WHEN is_learned = 1 THEN 1 ELSE 0 END) as learned FROM words GROUP BY LOWER(word_level)`);

function getWordStatsMap() {
  const rows = wordStatsByLevelStmt.all() as Array<{ lvl: string; total: number; learned: number | null }>;
  const map = new Map<string, { total: number; learned: number }>();
  rows.forEach((row) => {
    map.set(row.lvl, { total: row.total, learned: row.learned ?? 0 });
  });
  return map;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }) as session.Store,
    secret: process.env.SESSION_SECRET || 'please-change-this-secret',
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  next();
});

const ensureAuthenticated: express.RequestHandler = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.redirect('/login');
};

app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: req.query.error, message: req.query.message });
});

app.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/dashboard',
    failureRedirect: '/login?error=1',
  })
);

app.get('/register', (req, res) => {
  res.render('register', { error: req.query.error });
});

app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.redirect('/register?error=missing');
  }
  try {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (existing) {
      return res.redirect('/register?error=exists');
    }
    const hash = await bcrypt.hash(password, 10);
    db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email.trim().toLowerCase(), hash);
    return res.redirect('/login?message=registered');
  } catch (err) {
    console.error(err);
    return res.redirect('/register?error=server');
  }
});

app.get('/dashboard', ensureAuthenticated, (req, res) => {
  const user = req.user as UserRecord | undefined;
  const wordStatsMap = getWordStatsMap();
  const levels = levelDefinitions.map((definition) => {
    const key = definition.code.toLowerCase();
    const stats = wordStatsMap.get(key) ?? { total: 0, learned: 0 };
    const learnedPercent = stats.total ? Math.round((stats.learned / stats.total) * 100) : 0;
    return {
      ...definition,
      completion: Number(user?.[definition.field] ?? 0),
      wordStats: stats,
      learnedPercent,
      flashcardHref: key === 'a2.1' ? '/flashcards/A2.1' : undefined,
    };
  });
  res.render('dashboard', { levels });
});

app.get('/flashcards/:level', ensureAuthenticated, (req, res) => {
  const levelParamRaw = req.params.level;
  const levelParam = typeof levelParamRaw === 'string' ? levelParamRaw : 'A2.1';
  const normalized = levelParam.toLowerCase();
  const words = db
    .prepare(
      `SELECT word, word_type, word_translation, sentence, translation, success_streak, is_learned
         FROM words
        WHERE lower(word_level) = ?
        ORDER BY word`
    )
    .all(normalized) as Array<{
      word: string;
      word_type: string;
      word_translation: string;
      sentence: string;
      translation: string;
      success_streak: number;
      is_learned: number;
    }>;

  const totalWords = words.length;
  const learnedWords = words.filter((word) => word.is_learned === 1).length;
  const deck = words.filter((word) => word.is_learned === 0);

  res.render('flashcards', {
    levelCode: levelParam.toUpperCase(),
    totalWords,
    learnedWords,
    wordsJson: JSON.stringify(deck),
  });
});

app.post('/api/flashcards/answer', ensureAuthenticated, (req, res) => {
  const { word, level, result } = req.body ?? {};
  if (!word || !level || (result !== 'correct' && result !== 'incorrect')) {
    return res.status(400).json({ error: 'word, level and result are required' });
  }

  const normalized = String(level).toLowerCase();
  const current = db
    .prepare(
      `SELECT success_streak, is_learned
         FROM words
        WHERE word = ? AND lower(word_level) = ?`
    )
    .get(word, normalized) as { success_streak: number; is_learned: number } | undefined;

  if (!current) {
    return res.status(404).json({ error: 'Word not found' });
  }

  let streak = current.success_streak || 0;
  let learnedFlag = current.is_learned || 0;

  if (result === 'correct') {
    streak += 1;
    if (streak >= 5) {
      learnedFlag = 1;
      streak = 5;
    }
  } else {
    streak = 0;
    learnedFlag = 0;
  }

  db.prepare('UPDATE words SET success_streak = ?, is_learned = ?, updated_at = CURRENT_TIMESTAMP WHERE word = ? AND lower(word_level) = ?').run(streak, learnedFlag, word, normalized);

  const stats = db
    .prepare('SELECT COUNT(*) as total, SUM(CASE WHEN is_learned = 1 THEN 1 ELSE 0 END) as learned FROM words WHERE lower(word_level) = ?')
    .get(normalized) as { total: number; learned: number | null };

  return res.json({
    successStreak: streak,
    isLearned: learnedFlag === 1,
    stats: { total: stats.total, learned: stats.learned ?? 0 },
  });
});

app.post('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) {
      return next(err);
    }
    res.redirect('/login?message=logged-out');
  });
});

app.use((req, res) => {
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`Learning German app listening on http://localhost:${PORT}`);
});
