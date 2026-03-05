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

const rawEntries = fs
  .readFileSync(wordlistPath, 'utf-8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

const wordEntries = rawEntries.map((line) => {
  const [wordPart, typePart] = line.split('|');
  const word = (wordPart ?? '').trim();
  const wordType = (typePart ?? '').trim();
  if (!word) {
    throw new Error(`Malformed entry in word list: "${line}"`);
  }
  return { word, wordType };
});

const typeMap = new Map(wordEntries.map((entry) => [entry.word, entry.wordType]));

console.log(`Loaded ${wordEntries.length} words from ${wordlistPath}`);

const client = new OpenAI({ apiKey });
const db = new Database('learning-german.sqlite');

const wordsColumns = db.prepare('PRAGMA table_info(words)').all() as Array<{ name: string }>;
const requiredColumns = ['sentence', 'translation', 'word_translation', 'word_type'];
for (const column of requiredColumns) {
  if (!wordsColumns.some((col) => col.name === column)) {
    throw new Error(`Column "${column}" missing on words table. Run \`npm run db:migrate\` first.`);
  }
}

const insertBlank = db.prepare(
  `INSERT INTO words(word, word_type, word_translation, sentence, translation, updated_at)
   VALUES(?, ?, '', '', '', CURRENT_TIMESTAMP)
   ON CONFLICT(word) DO UPDATE SET
     word_type = CASE
       WHEN words.word_type IS NULL OR words.word_type = '' THEN excluded.word_type
       ELSE words.word_type
     END`
);

const upsertEntry = db.prepare(
  `UPDATE words
     SET sentence = ?,
         translation = ?,
         word_translation = ?,
         word_type = CASE
            WHEN word_type IS NULL OR word_type = '' THEN ?
            ELSE word_type
         END,
         updated_at = CURRENT_TIMESTAMP
   WHERE word = ?`
);

// Seed every word with its type so the DB stays aligned with the Wortliste.
for (const entry of wordEntries) {
  insertBlank.run(entry.word, entry.wordType);
}

const pendingRows = db
  .prepare(
    `SELECT word, word_type, word_translation, sentence, translation
       FROM words
      WHERE word_translation = ''
         OR sentence = ''
         OR translation = ''
         OR word_type = ''
      ORDER BY word`
  )
  .all() as Array<{
  word: string;
  word_type: string;
  word_translation: string;
  sentence: string;
  translation: string;
}>;

if (pendingRows.length === 0) {
  console.log('No pending words. Everything is already populated.');
  process.exit(0);
}

const workSet = pendingRows.slice(offset, offset + escapeCount);
console.log(
  `Need enrichment for ${pendingRows.length} words. Processing ${workSet.length} (offset ${offset}).`
);

async function main() {
  for (let i = 0; i < workSet.length; i += batchSize) {
    const batch = workSet.slice(i, i + batchSize);
    console.log(`\nBatch ${Math.floor(i / batchSize) + 1}: ${batch.length} words`);
    for (const row of batch) {
      const inferredType = row.word_type || typeMap.get(row.word) || 'word';
      try {
        const result = await withRetry(() => generateEntry(client, row.word, inferredType), 3);
        upsertEntry.run(
          result.sentence.trim(),
          result.sentenceTranslation.trim(),
          result.wordTranslation.trim(),
          inferredType,
          row.word
        );
        console.log(
          `✔ ${row.word} (${inferredType}) => ${result.wordTranslation.trim()} | ${result.sentence.trim()} // ${result.sentenceTranslation.trim()}`
        );
      } catch (error) {
        console.error(`✖ ${row.word}: ${(error as Error).message}`);
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

const TYPE_DESCRIPTIONS: Record<string, string> = {
  noun: 'noun',
  verb: 'verb',
  adjective: 'adjective',
  adverb: 'adverb',
  preposition: 'preposition',
  pronoun: 'pronoun',
  conjunction: 'conjunction',
  determiner: 'determiner or article',
  expression: 'expression',
  other: 'word',
};

const TYPE_GUIDANCE: Record<string, string> = {
  noun: 'Return the singular translation for the noun and craft a sentence that clearly shows it as a subject or object.',
  verb: 'Return the infinitive translation of the verb and use a naturally conjugated form inside the sentence.',
  adjective: 'Return the base-form translation of the adjective and place it before a noun or after a copula in the sentence.',
  adverb: 'Return the base adverb translation and feature it modifying a verb/adjective in the sentence.',
  preposition: 'Return the equivalent preposition and include a sentence where it governs an appropriate object.',
  pronoun: 'Return the closest English pronoun and show how it replaces a noun in the sentence.',
  conjunction: 'Return the conjunction and build a sentence that links two clauses.',
  determiner: 'Return the determiner/article meaning and show it modifying a noun.',
  expression: 'Return an idiomatic translation and place it in conversational context.',
  other: 'Return the best guess for the word meaning and showcase it naturally.',
};

async function generateEntry(
  clientInstance: OpenAI,
  word: string,
  wordType: string
): Promise<{ wordTranslation: string; sentence: string; sentenceTranslation: string }> {
  const normalizedType = wordType.toLowerCase();
  const typeDescription = TYPE_DESCRIPTIONS[normalizedType] ?? 'word';
  const guidance = TYPE_GUIDANCE[normalizedType] ?? TYPE_GUIDANCE.other;
  const prompt = `You are enriching German vocabulary. The entry "${word}" is a ${typeDescription}. ${guidance}\n` +
    'Return JSON: {"wordTranslation":"<English meaning of the word>","sentence":"<German sentence using the word>","sentenceTranslation":"<English translation of that sentence>"}. ' +
    'Keep the word inside the German sentence exactly once if possible.';
  // Prompt summary: Ask the model (in English) to provide the word meaning plus a German example sentence and its English translation, tailored to the word type.

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

  let parsed: { wordTranslation?: string; sentence?: string; sentenceTranslation?: string };
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${(err as Error).message}. Raw: ${content}`);
  }

  if (!parsed.wordTranslation || !parsed.sentence || !parsed.sentenceTranslation) {
    throw new Error('Response missing required fields');
  }

  return {
    wordTranslation: parsed.wordTranslation,
    sentence: parsed.sentence,
    sentenceTranslation: parsed.sentenceTranslation,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
