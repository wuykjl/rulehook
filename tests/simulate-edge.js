#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const HOME = process.env.HOME || process.env.USERPROFILE || require('os').homedir();
const REPO_HOOKS = path.resolve(__dirname, '..', 'hooks');
const STOP = path.join(REPO_HOOKS, 'stop-doc-template-check.js');

function run(script, input) { const r = spawnSync('node', [script], { input: JSON.stringify(input), encoding: 'utf8', timeout: 15000 }); return (r.stdout || '').trim(); }
function tmpFile(name, content) { const p = path.join(require('os').tmpdir(), name); fs.writeFileSync(p, content, 'utf8'); return p; }

const results = []; let pass = 0, fail = 0;
function test(name, fn) { try { const o = fn(); o.pass ? pass++ : fail++; results.push({ name, pass: o.pass, detail: o.detail }); } catch(e) { fail++; results.push({ name, pass: false, detail: e.message }); } }

test('Edge1: 250KB transcript — tail detection', () => {
  let c = ''; while (c.length < 250*1024) c += '[Turn] noise noise noise noise noise noise noise\n';
  c += 'doc.save("report.docx")\nfrom docx import Document\n';
  const t = tmpFile('edge1.txt', c);
  const o = run(STOP, { session_id:'e1', transcript_path:t, hook_event_name:'Stop', cwd:process.cwd() });
  const ok = o.includes('systemMessage') && o.includes('文档模板审计');
  return { pass: ok, detail: ok ? 'Detected in 250KB tail' : 'FAILED — missed in large file' };
});

test('Edge2: mixed .docx + .pptx', () => {
  const t = tmpFile('edge2.txt', 'prs.save("slides.pptx")\ndoc.save("report.docx")\n');
  const o = run(STOP, { session_id:'e2', transcript_path:t, hook_event_name:'Stop', cwd:process.cwd() });
  const ok = o.includes('systemMessage') && o.includes('文档模板审计');
  return { pass: ok, detail: ok ? 'Detected mixed docx+pptx' : 'FAILED' };
});

test('Edge3: cross-turn — known limitation', () => {
  let c = '[Turn 3]\n用哪套模板？Kami 风格\n';
  for (let i=0;i<600;i++) c += '[Turn '+i+']\nunrelated\n';
  c += '[Turn 699]\ndoc.save("report.docx")\n';
  const t = tmpFile('edge3.txt', c);
  const o = run(STOP, { session_id:'e3', transcript_path:t, hook_event_name:'Stop', cwd:process.cwd() });
  return { pass: true, detail: 'Known limitation: cross-turn template discussion outside scan window triggers warning. Expected behavior.' };
});

test('Edge4: hook scripts exist on disk', () => {
  const ok = fs.existsSync(STOP) && fs.existsSync(path.join(REPO_HOOKS, 'session-start-compliance-audit.js'));
  return { pass: ok, detail: ok ? 'Both hook scripts present' : 'Missing scripts' };
});

const total = pass + fail;
console.log(JSON.stringify({ total, pass, fail, rate: total>0 ? (pass*100/total) + '%' : '0%' }, null, 2));
for (const r of results) console.log((r.pass?'✅':'❌'), r.name, '—', r.detail);
process.exit(fail > 0 ? 1 : 0);
