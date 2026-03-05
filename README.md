# Learning German

A minimal TypeScript + Express starter that keeps user accounts in SQLite, authenticates with Passport.js (local strategy), and renders simple EJS views for login, registration, and a protected dashboard. Sessions are stored in SQLite as well so the app works out-of-the-box with a single database file.

## Stack

- Node.js + TypeScript
- Express + EJS templates
- Passport.js (local strategy) for login
- better-sqlite3 for the primary database
- connect-sqlite3 + express-session for storing sessions

## Getting started

```bash
cd ~/Downloads/learning-german
npm install          # already done for you, rerun after pulling updates
npm run dev          # runs ts-node-dev on http://localhost:4174
```

The first user registers via `/register`. After that, you can log in at `/login` and you’ll land on the protected `/dashboard` route.

### Environment variables

- `PORT` (default `4174`)
- `SESSION_SECRET` (defaults to `please-change-this-secret`; set a real value for production)

## Building for deployment

```bash
npm run build
npm start
```

This compiles to `dist/` and runs the JavaScript output.

## Database files

- `learning-german.sqlite` — users table
- `sessions.sqlite` — session storage

You can inspect these files with any SQLite browser if needed.

## Ngrok

Once the dev server is running locally, expose it with:

```bash
grok http 4174
```

Share the HTTPS URL ngrok prints so others can visit the login page.

## Word sentence enrichment

A helper script (`src/scripts/enrichWords.ts`) ingests the alphabetic word list (`data/german-wordlist.txt`) and asks OpenAI for a high-frequency German sentence that naturally contains each word.

Usage:

```bash
OPENAI_API_KEY=sk-... npm run enrich:words -- --escape 5 --offset 0
```

Parameters:
- `--escape` – how many words to process in this batch (name left as requested).
- `--offset` – how many words to skip before processing.

Results are stored in the `words` table inside `learning-german.sqlite` (`word`, `sentence`, `translation`, `updated_at`).
