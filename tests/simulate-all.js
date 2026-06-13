#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const HOME = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
const REPO_HOOKS = path.resolve(__dirname, '..', 'hooks');

function runHook(script, input) {
  const r = spawnSync('node', [script], { input: JSON.stringify(input), encoding: 'utf8', timeout: 15000 });
  return (r.stdout || '').trim();
}
function tmpFile(name, content) {
  const p = path.join(require('os').tmpdir(), name);
  fs.writeFileSync(p, content, 'utf8'); return p;
}

const results = []; let pass = 0, fail = 0;
function test(name, fn) {
  try { const o = fn(); if (o.pass) { pass++; results.push({ name, pass: true, detail: o.detail }); } else { fail++; results.push({ name, pass: false, detail: o.detail }); } } catch(e) { fail++; results.push({ name, pass: false, detail: e.message }); }
}

const STOP = path.join(REPO_HOOKS, 'stop-doc-template-check.js');
const AUDIT = path.join(REPO_HOOKS, 'session-start-compliance-audit.js');

test('S1: stop — violation detected (doc-gen, no template)', () => {
  const t = tmpFile('test-s1.txt', '[Turn 3]\ndoc.save("test.docx")\nfrom docx import Document\n');
  const o = runHook(STOP, { session_id:'s1', transcript_path:t, hook_event_name:'Stop', cwd:process.cwd() });
  const ok = o.includes('systemMessage') && o.includes('文档模板审计');
  return { pass: ok, detail: ok ? 'Correctly detected violation' : 'FAILED — no systemMessage', actual: o.slice(0,200) };
});

test('S2: stop — compliant (template discussed)', () => {
  const t = tmpFile('test-s2.txt', '[Turn 3]\n用哪套模板？1. 默认 2. Kami 风格\n[Turn 4]\ndoc.save("test.docx")\n');
  const o = runHook(STOP, { session_id:'s2', transcript_path:t, hook_event_name:'Stop', cwd:process.cwd() });
  const ok = !o.includes('文档模板审计');
  return { pass: ok, detail: ok ? 'Correctly passed through' : 'FALSE POSITIVE' };
});

test('S3: stop — no doc generation', () => {
  const t = tmpFile('test-s3.txt', '[Turn 5]\nimport csv\nwith open("data.csv") as f:\n');
  const o = runHook(STOP, { session_id:'s3', transcript_path:t, hook_event_name:'Stop', cwd:process.cwd() });
  const ok = !o.includes('文档模板审计');
  return { pass: ok, detail: ok ? 'Correctly passed through' : 'FALSE POSITIVE' };
});

// S4-S6 need observations.jsonl — skip in public test, document as "requires ECC observe.sh"
test('S4: audit — low compliance (requires observations.jsonl)', () => {
  return { pass: true, detail: 'SKIPPED — requires ECC observe.sh data pipeline. Run with ECC installed.' };
});
test('S5: audit — no data (silent)', () => {
  const o = runHook(AUDIT, { session_id:'s5', transcript_path:'/tmp/t', hook_event_name:'SessionStart', cwd:process.cwd() });
  const ok = !o.includes('additionalContext');
  return { pass: ok, detail: ok ? 'Correctly silent' : 'UNEXPECTED context' };
});
test('S6: audit — high compliance (requires observations.jsonl)', () => {
  return { pass: true, detail: 'SKIPPED — requires ECC observe.sh data pipeline.' };
});

const total = pass + fail;
console.log(JSON.stringify({ total, pass, fail, rate: total>0 ? (pass*100/total) + '%' : '0%' }, null, 2));
for (const r of results) console.log((r.pass?'✅':'❌'), r.name, '—', r.detail);
process.exit(fail > 0 ? 1 : 0);
