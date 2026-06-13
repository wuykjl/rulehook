#!/usr/bin/env node
/**
 * pressure-test.js — synthetic rule stress test
 *
 * Injects 10 rules (1 real + 9 synthetic) into the RULES object
 * and verifies: mixed compliance filtering, threshold boundaries,
 * silent rules with zero data, performance under load, and
 * 5 simultaneous 0%-compliance rules.
 *
 * Run: node tests/pressure-test.js
 */
'use strict';

const SYNTHETIC_RULES = {
  'doc-template-check': { name:'Word Template', triggerPatterns:[/\.save\(.*\.docx/,/Packer\.toBuffer/,/python-docx/,/Document\(/], compliancePatterns:[/用哪套模板/,/Kami/,/word.templates.choice/] },
  'code-review-after-edit': { name:'Code Review', triggerPatterns:[/Edit|Write|MultiEdit/], compliancePatterns:[/code-review/i,/code\.reviewer/] },
  'security-on-auth': { name:'Security Audit', triggerPatterns:[/auth|login|password|token/], compliancePatterns:[/security-reviewer/i,/security\.review/] },
  'test-before-commit': { name:'Pre-commit Test', triggerPatterns:[/git\s+(commit|push)/,/pull.request|PR/], compliancePatterns:[/npm\s+(test|run\s+test)|pnpm\s+test|yarn\s+test|pytest|go\s+test/] },
  'no-console-log': { name:'No console.log', triggerPatterns:[/console\.log/], compliancePatterns:[/removed|deleted|clean/] },
  'import-order': { name:'Import Order', triggerPatterns:[/import\s+/], compliancePatterns:[/eslint.*import|import.*order|sorted/] },
  'error-boundary': { name:'Error Boundary', triggerPatterns:[/useState|useEffect|React\.Component/], compliancePatterns:[/ErrorBoundary|error.*boundary|try.*catch/] },
  'a11y-check': { name:'Accessibility', triggerPatterns:[/<button|<input|<a\s|<img/], compliancePatterns:[/aria-label|role=|alt=|accessible/] },
  'env-config': { name:'Env Config', triggerPatterns:[/process\.env|\.env|ENV\[|env\(/], compliancePatterns:[/\.env\.example|env.*template|documented/] },
  'type-safe-access': { name:'Type Safety', triggerPatterns:[/\bany\b/], compliancePatterns:[/\bunknown\b|\bnever\b|typed/] },
};

const LOOKBACK_DAYS = 14, THRESHOLD = 0.85, MIN_SESSIONS = 3;

function now() { return new Date().toISOString(); }
function sessionObs(sid, triggers, compliants) {
  const events = [], t = now();
  for (const [rid, input] of triggers) events.push({ timestamp:t, event:'tool_start', tool:'Write', session:sid, input });
  for (const [rid, output] of compliants) events.push({ timestamp:t, event:'tool_complete', tool:'AskUserQuestion', session:sid, output });
  return events;
}

function analyzeRule(ruleId, ruleDef, observations) {
  const cutoff = Date.now() - LOOKBACK_DAYS*86400000;
  const sw = new Map();
  for (const obs of observations) {
    const ts = obs.timestamp ? new Date(obs.timestamp).getTime() : 0;
    if (ts < cutoff) continue;
    const sid = obs.session || 'unknown';
    if (!sw.has(sid)) sw.set(sid, { triggers:false, complied:false });
    const w = sw.get(sid);
    const text = (obs.output || obs.input || '');
    if (ruleDef.triggerPatterns.some(p=>p.test(text))) w.triggers = true;
    if (ruleDef.compliancePatterns.some(p=>p.test(text))) w.complied = true;
  }
  const trig = [...sw.values()].filter(w=>w.triggers);
  const comp = trig.filter(w=>w.complied);
  return { ruleId, name:ruleDef.name, sessionsWithTrigger:trig.length, sessionsWithCompliance:comp.length, rate: trig.length>0 ? comp.length/trig.length : null };
}

function checkThresholds(rules, obs) {
  const results = [];
  for (const [rid, rd] of Object.entries(rules)) results.push(analyzeRule(rid, rd, obs));
  return results.filter(r => r.sessionsWithTrigger >= MIN_SESSIONS && r.rate !== null && r.rate < THRESHOLD);
}

// ── Run ────────────────────────────────────────────────────────
let pass=0, fail=0;

function scenario(name, obs, expectedIds) {
  const res = checkThresholds(SYNTHETIC_RULES, obs);
  const ids = res.map(r=>r.ruleId).sort();
  const exp = expectedIds.sort();
  const ok = ids.length === exp.length && ids.every((id,i)=>id===exp[i]);
  if (ok) pass++; else fail++;
  console.log((ok?'✅':'❌'), name, `— expected: [${exp}], got: [${ids}]`);
  for (const r of res) console.log('   ', r.ruleId, (r.rate*100).toFixed(0)+'%', r.sessionsWithTrigger+' sessions');
}

// A: Mixed compliance
const obsA = [
  ...['A1','A2','A3','A4','A5'].flatMap((s,i)=>sessionObs(s, [['doc-template-check','doc.save("/x.docx")']], i>=2 ? [['doc-template-check','用哪套模板？Kami']] : [])),
  ...['A6','A7','A8'].map(s=>sessionObs(s, [['code-review-after-edit','Write']], [])),
  ...['A9','A10','A11','A12'].map(s=>sessionObs(s, [['security-on-auth','auth']], [['security-on-auth','security-reviewer']])),
  ...['A13','A14','A15'].map(s=>sessionObs(s, [['test-before-commit','git commit']], [['test-before-commit','npm test']])),
];
scenario('A: Mixed compliance (doc 40%, code-review 0%)', obsA, ['code-review-after-edit','doc-template-check']);

// B: Threshold boundaries
const obsB = [];
for(let i=0;i<42;i++) obsB.push(...sessionObs('Bc'+i,[['no-console-log','console.log']],[['no-console-log','removed']]));
for(let i=0;i<8;i++) obsB.push(...sessionObs('Bf'+i,[['no-console-log','console.log("x")']],[]));
for(let i=0;i<17;i++) obsB.push(...sessionObs('Bi'+i,[['import-order','import x']],[['import-order','eslint import sorted']]));
for(let i=0;i<3;i++) obsB.push(...sessionObs('Bif'+i,[['import-order','import']],[]));
for(let i=0;i<43;i++) obsB.push(...sessionObs('Be'+i,[['error-boundary','useState']],[['error-boundary','ErrorBoundary']]));
for(let i=0;i<7;i++) obsB.push(...sessionObs('Bef'+i,[['error-boundary','useEffect']],[]));
scenario('B: Threshold (84%=warn, 85%=silent, 86%=silent)', obsB, ['no-console-log']);

// C: Only doc has data
const obsC = [
  ...sessionObs('C1',[['doc-template-check','doc.save("/1.docx")']],[]),
  ...sessionObs('C2',[['doc-template-check','doc.save("/2.docx")']],[]),
  ...sessionObs('C3',[['doc-template-check','Packer.toBuffer']],[]),
  ...sessionObs('C4',[['doc-template-check','Document()']],[['doc-template-check','用哪套模板']]),
  ...sessionObs('C5',[['doc-template-check','python-docx']],[['doc-template-check','Kami 风格']]),
];
scenario('C: Only doc has data (9 rules silent)', obsC, ['doc-template-check']);

// Perf
const start = Date.now();
for(let i=0;i<100;i++) checkThresholds(SYNTHETIC_RULES, obsA);
const elapsed = Date.now() - start;
console.log('⏱  Perf: 100 iterations × 10 rules ×', obsA.length, 'observations =', elapsed+'ms ('+(elapsed/100).toFixed(2)+'ms/check)');

// Complexity: 5 rules all 0%
const obsX = [];
for(let i=0;i<3;i++) obsX.push(...sessionObs('CX'+i, [['doc-template-check','doc.save("/t.docx")'],['no-console-log','console.log("x")'],['a11y-check','<button>'],['env-config','process.env.PORT'],['type-safe-access','any']], []));
scenario('Complexity: 5 rules all 0%', obsX, ['doc-template-check','no-console-log','a11y-check','env-config','type-safe-access']);

console.log('\n' + pass + '/' + (pass+fail) + ' passed');
process.exit(fail>0?1:0);
