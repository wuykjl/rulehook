---
name: rulehook
description: Turn soft Claude Code rules into enforced hooks. Use when rules are being ignored, agent forgets preferences, or you want automated compliance checking. Triggers on: rules not followed, context overload causing forgotten preferences, hook-based enforcement, compliance audit, agent governance, behavior guardrails.
version: 1.0.0
license: MIT
allowed-tools: Bash(*), Read, Write, Edit, Glob, Grep
---

# rulehook — Three-Layer Compliance Audit System

## ⚠️ READ FIRST — MANDATORY

Before installing, understand: rulehook enforces rules by watching your Claude agent's behavior. It will remind you when you violate your own rules.

**After installation:** copy `hooks/` scripts to `~/.claude/scripts/hooks/`, register in `~/.claude/settings.json`, and add the L1 prevention block to any document-generation skill.

## Quick Install

```bash
# 1. Copy hooks
cp hooks/stop-doc-template-check.js ~/.claude/scripts/hooks/
cp hooks/session-start-compliance-audit.js ~/.claude/scripts/hooks/

# 2. Merge config/settings-snippet.json into ~/.claude/settings.json
# 3. Add PRE-GENERATION-CHECK to relevant skills (see skills/PRE-GENERATION-CHECK.md)
# 4. Verify
node tests/simulate-all.js
```

## What Problem This Solves

Claude Code has 20+ rules in `~/.claude/rules/`. Rules are **soft constraints** — the agent reads them but skips them under engineering momentum. The result: you keep reminding Claude "I told you last time."

rulehook bridges hard hooks with soft rules through three defence lines:

1. **L1 Prevention** — SKILL.md injection: "Before generating, ask the user which template"
2. **L2 Intercept** — Stop hook two-stage grep: scan transcript → warn on violation
3. **L3 Warning** — SessionStart compliance audit: "You scored 40% on this rule last week"

Zero token cost. Zero external dependencies. Node.js stdlib only.

## Architecture

```
User says "make a Word doc"
  → L1 fires (skill PRE-GENERATION CHECK)
  → Agent generates docx
  → Stop hook: grep transcript → violation? → systemMessage
  → Next session: SessionStart reads observations.jsonl → "40% compliance — be careful"
```

## Adding Rules

Edit `hooks/session-start-compliance-audit.js` → `RULES` object. One JSON entry per rule.

## Documentation

Full design doc: `docs/合规审计系统-三层防线机制.md`
Test suite: `tests/`
