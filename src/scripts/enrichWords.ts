import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import minimist from 'minimist';
import OpenAI from 'openai';

type WordRecord = {
  word: string;
  sentence: string;
};

const args = minimist(process.argv.slice(2));
const escapeCount = Number(args.escape ?? 20);
const offset = Number(args.offset ?? 0);

if (!Number.isFinite(escapeCount) || escapeCount <= 0) {
  throw new Error('Please provide a positive number for --escape');
}
if (!Number.isFinite(offset) || offset < 0) {
  throw new Error('Please provide a non-negative number for --offset');
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not defined');
}

const wordlistPath = path.resolve(__dirname, '../../data/german-wordlist.txt');
if (!fs.existsSync(wordlistPath)) {
  throw new Error(`Word list not found at ${wordlistPath}`);
}

const rawWordList = fs.readFileSync(wordlistPath, 'utf-8');
const words = extractWords(rawWordList);

if (offset >= words.length) {
  console.log(`Offset ${offset} beyond word count (${words.length}). Nothing to do.`);
  process.exit(0);
}

const slice = words.slice(offset, offset + escapeCount);
console.log(`Processing ${slice.length} words (offset ${offset}).`);

const client = new OpenAI({ apiKey });
const db = new Database('learning-german.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    word TEXT PRIMARY KEY,
    sentence TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertStatement = db.prepare(
  `INSERT INTO words(word, sentence, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(word) DO UPDATE SET sentence=excluded.sentence, updated_at=CURRENT_TIMESTAMP`
);

async function main() {
  for (const word of slice) {
    try {
      const sentence = await generateSentence(client, word);
      const cleanedSentence = sentence.trim();
      insertStatement.run(word, cleanedSentence);
      console.log(`✔ Saved sentence for "${word}": ${cleanedSentence}`);
    } catch (error) {
      console.error(`✖ Failed for "${word}":`, (error as Error).message);
    }
  }
}

function extractWords(text: string): string[] {
  const matches = new Set<string>();
  const articlePattern = /\b(?:der|die|das)\s+[A-Za-zÄÖÜäöüß\-]+/g;
  const standalonePattern = /\b[A-Za-zÄÖÜäöüß]{3,}[A-Za-zÄÖÜäöüß\-]+/g;

  const addMatch = (token: string | null) => {
    if (!token) return;
    const cleaned = token
      .replace(/[.,;:()\[\]"“”]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return;
    if (/\d/.test(cleaned)) return;
    if (cleaned.startsWith('---') || cleaned.includes('|')) return;
    matches.add(cleaned);
  };

  let result: RegExpExecArray | null;
  while ((result = articlePattern.exec(text)) !== null) {
    addMatch(result[0]);
  }
  while ((result = standalonePattern.exec(text)) !== null) {
    addMatch(result[0]);
  }

  return Array.from(matches);
}

async function generateSentence(client: OpenAI, word: string): Promise<string> {
  const prompt = `Du bekommst ein deutsches Lexikoneintrag. Gib mir nur gültiges JSON der Form {"sentence":"..."} mit einem sehr häufigen, idiomatischen deutschen Satz, der das Wort "${word}" auf natürliche Weise enthält. Keine Erklärungen.`;
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'Du bist ein hilfreicher deutscher Satzgenerator.' },
      { role: 'user', content: prompt },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('OpenAI returned empty content');
  }

  try {
    const parsed: WordRecord = JSON.parse(content);
    if (!parsed.sentence) {
      throw new Error('JSON fehlte das Feld sentence');
    }
    return parsed.sentence;
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${(err as Error).message}. Raw: ${content}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
