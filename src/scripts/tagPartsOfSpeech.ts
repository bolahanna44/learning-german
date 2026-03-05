import fs from 'fs';
import path from 'path';
import minimist from 'minimist';
import OpenAI from 'openai';

const POS_OPTIONS = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'pronoun',
  'conjunction',
  'determiner',
  'expression',
  'other',
];

const args = minimist(process.argv.slice(2));
const batchSize = Number(args.batch ?? 25);
const offset = Number(args.offset ?? 0);
const limitArg = args.limit === undefined ? undefined : Number(args.limit);
const limit = limitArg && limitArg > 0 ? limitArg : undefined;

if (!Number.isFinite(batchSize) || batchSize <= 0) {
  throw new Error('Provide a positive number for --batch');
}
if (!Number.isFinite(offset) || offset < 0) {
  throw new Error('Provide a non-negative number for --offset');
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not defined');
}

const wordlistPath = path.resolve(__dirname, '../../data/german-wordlist.txt');
if (!fs.existsSync(wordlistPath)) {
  throw new Error(`Cannot find ${wordlistPath}`);
}

const entries = fs
  .readFileSync(wordlistPath, 'utf-8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [wordPart, tagPart] = line.split('|');
    const word = (wordPart ?? '').trim();
    const tag = (tagPart ?? '').trim();
    return { word, tag };
  })
  .filter((entry) => entry.word.length > 0);

const pending = entries
  .filter((entry) => !entry.tag)
  .slice(offset, limit ? offset + limit : undefined);

if (pending.length === 0) {
  console.log('No entries need tagging.');
  process.exit(0);
}

console.log(`Tagging ${pending.length} words (offset ${offset}, batch ${batchSize}).`);

const client = new OpenAI({ apiKey });

async function main() {
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    console.log(`\nBatch ${i / batchSize + 1} (${batch.length} words)`);
    try {
      const tags = await classifyBatch(batch.map((entry) => entry.word));
      let taggedCount = 0;
      tags.forEach(({ word, pos }) => {
        const idx = entries.findIndex((entry) => entry.word === word);
        const target = idx >= 0 ? entries[idx] : undefined;
        if (target) {
          target.tag = pos;
          taggedCount += 1;
        } else {
          console.warn(`Word not found in master list: ${word}`);
        }
      });
      console.log(`✔ Tagged ${taggedCount} entries in batch ${i / batchSize + 1}`);
    } catch (error) {
      console.error('Batch failed:', (error as Error).message);
      throw error;
    }
  }

  const updated = entries.map((entry) => `${entry.word}|${entry.tag || 'other'}`).join('\n');
  fs.writeFileSync(wordlistPath, updated);
  console.log(`\nUpdated ${wordlistPath}`);
}

async function classifyBatch(words: string[]): Promise<Array<{ word: string; pos: string }>> {
  const prompt = `Classify each of the following German lexical entries by part of speech.\n` +
    `Respond with JSON array [{"word":"...","pos":"..."}]. Use only these labels: ${POS_OPTIONS.join(', ')}.\n` +
    `If an entry begins with an article (der/die/das), treat it as a noun.\n` +
    words.map((word, index) => `${index + 1}. ${word}`).join('\n');

  const response = await withRetry(() =>
    client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'You respond with JSON only.' },
        { role: 'user', content: prompt },
      ],
    })
  );

  const rawContent = response.choices[0]?.message?.content?.trim();
  if (!rawContent) {
    throw new Error('OpenAI returned empty content');
  }
  const content = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();

  let parsed: Array<{ word: string; pos: string }>;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${(err as Error).message}. Raw: ${content}`);
  }

  return parsed.map((item) => ({
    word: item.word,
    pos: POS_OPTIONS.includes(item.pos) ? item.pos : 'other',
  }));
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      attempt += 1;
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      const delay = Math.min(5000, 1000 * attempt);
      console.warn(`Retry ${attempt}/${maxRetries} after ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
