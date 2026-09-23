/// <reference types="node" />
// Scores note understanding on tests/ai-cases.ts with the on-device model (run
// here with node-llama-cpp, the same llama.cpp engine the app uses), the rules
// alone, and the hybrid the app uses (rules first, model only when they miss).
//
//   npm i --no-save node-llama-cpp && npx tsx scripts/ai-eval.mts path/to/model.gguf [name]
//
// Writes a Markdown report to $GITHUB_STEP_SUMMARY when running in CI.

import { appendFileSync } from 'node:fs';
import { ChatHistoryItem, getLlama, LlamaChatSession } from 'node-llama-cpp';
import { ANSWER_SCHEMA, answerToCommand, buildMessages, parseAnswer, rulesNeedHelp } from '../src/ai/prompt';
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

const pct = (n: number, total: number) => `${n}/${total} (${Math.round((n / total) * 100)}%)`;

async function main() {
  const [modelPath, name = modelPath?.split('/').pop()] = process.argv.slice(2);
  if (!modelPath) throw new Error('usage: ai-eval.mts <model.gguf> [name]');
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  const context = await model.createContext({ contextSize: 4096 });
  const grammar = await llama.createGrammarForJsonSchema(ANSWER_SCHEMA as any);

  // Same messages as the app. Everything but the last turn is identical for
  // every note, so one session with that history is reused (and cached).
  const template = buildMessages('x', EVAL_ITEMS, EVAL_NOW);
  const history: ChatHistoryItem[] = template.slice(0, -1).map((m) =>
    m.role === 'system' ? { type: 'system', text: m.content } : m.role === 'user' ? { type: 'user', text: m.content } : { type: 'model', response: [m.content] },
  );
  const session = new LlamaChatSession({ contextSequence: context.getSequence() });

  const rows: string[] = [];
  let aiOk = 0;
  let rulesOk = 0;
  let hybridOk = 0;
  let asked = 0;
  const times: number[] = [];
  for (const { note, expect } of CASES) {
    const rulesCmd = parseCommand(note, EVAL_NOW, EVAL_TODAY);
    const rulesBad = check(rulesCmd, expect);
    if (!rulesBad.length) rulesOk++;

    session.setChatHistory(history);
    const t0 = Date.now();
    const text = await session.prompt(buildMessages(note, EVAL_ITEMS, EVAL_NOW).at(-1)!.content, {
      grammar,
      temperature: 0,
      maxTokens: 160,
    });
    const ms = Date.now() - t0;
    times.push(ms);

    const aiCmd = answerToCommand(parseAnswer(text), note, EVAL_NOW, EVAL_TODAY);
    const aiBad = check(aiCmd, expect);
    if (!aiBad.length) aiOk++;
    const useAi = rulesNeedHelp(rulesCmd);
    if (useAi) asked++;
    const hybridBad = useAi && aiCmd ? aiBad : rulesBad;
    if (!hybridBad.length) hybridOk++;

    const mark = (bad: string[]) => (bad.length ? `✗ ${bad.join('; ')}` : '✓');
    rows.push(`| ${note} | ${mark(aiBad)} | ${mark(rulesBad)} | ${useAi ? 'AI' : 'rules'} ${mark(hybridBad)} | ${ms} |`);
    console.log(`${aiBad.length ? 'AI ✗' : 'AI ✓'} ${rulesBad.length ? 'rules ✗' : 'rules ✓'} ${ms}ms  ${note}`);
    if (aiBad.length) console.log(`     model said: ${text}\n     ${aiBad.join('; ')}`);
  }

  const n = CASES.length;
  const sorted = [...times].sort((a, b) => a - b);
  const summary = [
    `## Note understanding: ${name}`,
    '',
    `- **Hybrid (what the app does: rules, model only when they miss — asked ${asked}×): ${pct(hybridOk, n)}**`,
    `- Model on every note: ${pct(aiOk, n)}`,
    `- Rules only: ${pct(rulesOk, n)}`,
    `- Time per note on this CI CPU, examples cached: median ${sorted[Math.floor(n / 2)]} ms, first ${times[0]} ms (phones differ)`,
    '',
    '| Note | Model | Rules | Hybrid | ms |',
    '| --- | --- | --- | --- | --- |',
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
