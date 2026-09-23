// Scores note understanding on tests/ai-cases.ts: the on-device model (run here
// with node-llama-cpp, the same llama.cpp engine the app uses) vs. the rules.
//
//   npm i --no-save node-llama-cpp && npx tsx scripts/ai-eval.ts path/to/model.gguf
//
// Writes a Markdown report to $GITHUB_STEP_SUMMARY when running in CI.

import { appendFileSync } from 'node:fs';
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import { ANSWER_SCHEMA, answerToCommand, buildUserMessage, parseAnswer, SYSTEM_PROMPT } from '../src/ai/prompt';
import { Command, parseCommand } from '../src/parser';
import { CASES, EVAL_ITEMS, EVAL_NOW, EVAL_TODAY, Expect } from '../tests/ai-cases';

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !['the', 'a', 'my', 'to', 'with'].includes(w))
    .map((w) => w.replace(/(ing|s)$/, ''));

function titleOk(expected: string, got: string | undefined): boolean {
  if (!got) return false;
  const e = words(expected);
  const g = words(got);
  return e.every((w) => g.some((x) => x.startsWith(w) || w.startsWith(x))) && g.length <= e.length + 2;
}

/** Returns the list of mismatched fields (empty = correct). */
function check(cmd: Command | null, ex: Expect): string[] {
  if (!cmd) return ['no answer'];
  if (cmd.kind !== ex.kind) return [`kind ${cmd.kind}≠${ex.kind}`];
  const c = cmd as any;
  const bad: string[] = [];
  const title = c.title ?? c.query;
  if (ex.title !== undefined && !titleOk(ex.title, title)) bad.push(`title "${title}"`);
  for (const k of ['date', 'start', 'duration', 'earliest', 'latest', 'interval'] as const) {
    if (ex[k] !== undefined && (c[k] ?? null) !== ex[k]) bad.push(`${k} ${JSON.stringify(c[k] ?? null)}≠${JSON.stringify(ex[k])}`);
  }
  if (ex.repeat !== undefined && JSON.stringify(c.repeat ?? null) !== JSON.stringify(ex.repeat)) {
    bad.push(`repeat ${JSON.stringify(c.repeat ?? null)}≠${JSON.stringify(ex.repeat)}`);
  }
  if (ex.patch && JSON.stringify(c.patch) !== JSON.stringify(ex.patch)) bad.push(`patch ${JSON.stringify(c.patch)}`);
  return bad;
}

async function main() {
  const modelPath = process.argv[2];
  if (!modelPath) throw new Error('usage: ai-eval.ts <model.gguf>');
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 2048 });
  const grammar = await llama.createGrammarForJsonSchema(ANSWER_SCHEMA as any);

  const rows: string[] = [];
  let aiOk = 0;
  let rulesOk = 0;
  let totalMs = 0;
  for (const { note, expect } of CASES) {
    const rulesBad = check(parseCommand(note, EVAL_NOW, EVAL_TODAY), expect);
    if (!rulesBad.length) rulesOk++;

    const sequence = context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: SYSTEM_PROMPT });
    const t0 = Date.now();
    const text = await session.prompt(buildUserMessage(note, EVAL_ITEMS, EVAL_NOW, EVAL_TODAY), {
      grammar,
      temperature: 0,
      maxTokens: 200,
    });
    const ms = Date.now() - t0;
    totalMs += ms;
    session.dispose();
    sequence.dispose();

    const raw = parseAnswer(text);
    const aiBad = check(answerToCommand(raw, note, EVAL_NOW, EVAL_TODAY), expect);
    if (!aiBad.length) aiOk++;
    const mark = (bad: string[]) => (bad.length ? `✗ ${bad.join('; ')}` : '✓');
    rows.push(`| ${note} | ${mark(aiBad)} | ${mark(rulesBad)} | ${ms} |`);
    console.log(`${aiBad.length ? 'AI ✗' : 'AI ✓'} ${rulesBad.length ? 'rules ✗' : 'rules ✓'} ${ms}ms  ${note}`);
    if (aiBad.length) console.log(`     model said: ${text}\n     ${aiBad.join('; ')}`);
  }

  const n = CASES.length;
  const summary = [
    `## Note understanding: ${modelPath.split('/').pop()}`,
    '',
    `- **AI (model + guards): ${aiOk}/${n} (${Math.round((aiOk / n) * 100)}%)**`,
    `- Rules only: ${rulesOk}/${n} (${Math.round((rulesOk / n) * 100)}%)`,
    `- Average time per note on this CI machine: ${Math.round(totalMs / n)} ms (phones will differ)`,
    '',
    '| Note | AI | Rules | ms |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
  console.log('\n' + summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
