import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';

const db: DatabaseInstance = new Database('learning-german.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;
