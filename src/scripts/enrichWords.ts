import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import minimist from 'minimist';
import OpenAI from 'openai';

const args = minimist(process.argv.slice(2));
const escapeCount = Number(args.escape ?? 25);
const offset = Number(args.offset ?? 0);
const batchSize = Number(args.batch ?? 5);

if (!Number.isFinite(escapeCount) || escapeCount <= 0) {
  throw new Error('Please provide a positive number for --escape');
}
if (!Number.isFinite(offset) || offset < 0) {
  throw new Error('Please provide a non-negative number for --offset');
}
if (!Number.isFinite(batchSize) || batchSize <= 0) {
  throw new Error('Please provide a positive number for --batch');
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not defined');
}

const wordlistPath = path.resolve(__dirname, '../../data/german-wordlist.txt');
if (!fs.existsSync(wordlistPath)) {
  throw new Error(`Word list not found at ${wordlistPath}`);
}

const wordList = fs
  .readFileSync(wordlistPath, 'utf-8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

console.log(`Loaded ${wordList.length} words from ${wordlistPath}`);

const client = new OpenAI({ apiKey });
const db = new Database('learning-german.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    word TEXT PRIMARY KEY,
    sentence TEXT NOT NULL DEFAULT '',
    translation TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const wordsColumns = db.prepare('PRAGMA table_info(words)').all() as Array<{ name: string }>;
if (!wordsColumns.some((col) => col.name === 'translation')) {
  db.exec("ALTER TABLE words ADD COLUMN translation TEXT NOT NULL DEFAULT ''");
}

const insertBlank = db.prepare(
  `INSERT INTO words(word, sentence, translation, updated_at)
   VALUES(?, '', '', CURRENT_TIMESTAMP)
   ON CONFLICT(word) DO NOTHING`
);

const upsertSentence = db.prepare(
  `UPDATE words
     SET sentence = ?,
         translation = ?,
         updated_at = CURRENT_TIMESTAMP
   WHERE word = ?`
);

// Seed every word so we can track which entries still need sentences.
for (const word of wordList) {
  insertBlank.run(word);
}

const pendingRows = db
  .prepare("SELECT word FROM words WHERE sentence = '' OR translation = '' ORDER BY word")
  .all() as Array<{ word: string }>;
const pendingWords = pendingRows.map((row) => row.word);

if (pendingWords.length === 0) {
  console.log('No pending words. Everything is already populated.');
  process.exit(0);
}

const workSet = pendingWords.slice(offset, offset + escapeCount);
console.log(
  `Need sentences/translations for ${pendingWords.length} words. Processing ${workSet.length} (offset ${offset}).`
);

async function main() {
  for (let i = 0; i < workSet.length; i += batchSize) {
    const batch = workSet.slice(i, i + batchSize);
    console.log(`\nBatch ${i / batchSize + 1}: ${batch.length} words`);
    for (const word of batch) {
      try {
        const { sentence, translation } = await withRetry(() => generateSentence(client, word), 3);
        upsertSentence.run(sentence.trim(), translation.trim(), word);
        console.log(`✔ ${word} => ${sentence.trim()} // ${translation.trim()}`);
      } catch (error) {
        console.error(`✖ ${word}: ${(error as Error).message}`);
      }
    }
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      attempt += 1;
      return await fn();
    } catch (err) {
      if (attempt >= retries) {
        throw err;
      }
      const delay = Math.min(4000, 500 * Math.pow(2, attempt));
      console.warn(`Retry ${attempt}/${retries} after ${(delay / 1000).toFixed(1)}s ...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function generateSentence(
  clientInstance: OpenAI,
  word: string
): Promise<{ sentence: string; translation: string }> {
  const prompt = `Return JSON {"sentence":"...","translation":"..."} where "sentence" is a common German sentence that naturally includes "${word}" and "translation" is the natural English translation of that sentence.`;
  const response = await clientInstance.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'Respond with JSON only. Do not add commentary.' },
      { role: 'user', content: prompt },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('OpenAI returned empty content');
  }

  let parsed: { sentence?: string; translation?: string };
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${(err as Error).message}. Raw: ${content}`);
  }

  if (!parsed.sentence || !parsed.translation) {
    throw new Error('Response missing sentence or translation');
  }

  return { sentence: parsed.sentence, translation: parsed.translation };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
