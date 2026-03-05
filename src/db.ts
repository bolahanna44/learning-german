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

const progressColumns = [
  'a11_progress',
  'a12_progress',
  'a21_progress',
  'a22_progress',
  'b11_progress',
  'b12_progress',
];

const existingColumns = (db
  .prepare("PRAGMA table_info(users)")
  .all() as Array<{ name: string }>
).map(row => row.name);

for (const column of progressColumns) {
  if (!existingColumns.includes(column)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER DEFAULT 0`);
  }
}

export default db;
