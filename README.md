# rulehook

> Turn Claude Code rules into hooks. Catch rule violations before you see them. Zero tokens, zero servers.

## What it does

Claude Code has rules (in `.claude/rules/`) and memories (in `memory/`). But rules are **soft constraints** — the agent often skips them under engineering momentum. rulehook bridges the gap: it watches the transcript for rule violations and injects a reminder before the response reaches you.

## Architecture — three defence lines

```
L1: SKILL.md prevention → "Before generating a document, ask the user which template"
    └─ Inserted at the TOP of a skill's SKILL.md — agent sees it immediately

L2: Stop hook real-time intercept → grep transcript tail for doc-gen patterns
    └─ 95% of responses pass through silently (~10 ms). On hit → systemMessage warning

L3: SessionStart trend warning → read observations.jsonl, compute compliance rate
    └─ If your compliance is < 85% over the last 14 days, inject additionalContext
```

## Install

### 1. Copy hooks

```bash
cp hooks/stop-doc-template-check.js ~/.claude/scripts/hooks/
cp hooks/session-start-compliance-audit.js ~/.claude/scripts/hooks/
```

### 2. Register in settings.json

Add to `~/.claude/settings.json`:

```json
"hooks": {
  "SessionStart": [
    {
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node \"~/.claude/scripts/hooks/session-start-compliance-audit.js\"", "timeout": 15 }],
      "id": "session-start:compliance-audit"
    }
  ],
  "Stop": [
    {
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "node \"~/.claude/scripts/hooks/stop-doc-template-check.js\"", "timeout": 15 }],
      "id": "stop:doc-template-check"
    }
  ]
}
```

### 3. Add L1 prevention to relevant skills

Open the SKILL.md of any document-generation skill (e.g. `~/.claude/skills/docx/SKILL.md`) and insert at the top:

```markdown
## ⚠️ PRE-GENERATION CHECK (MANDATORY — DO NOT SKIP)

**Before writing any document generation code**, you MUST:
1. Read memory/<rule-name>.md
2. Ask the user: "<checklist question>"
3. Wait for user confirmation before proceeding
```

See [skills/PRE-GENERATION-CHECK.md](skills/PRE-GENERATION-CHECK.md) for the full template.

### 4. Verify

```bash
node tests/simulate-all.js   # 6 scenarios — should be 100% pass
node tests/simulate-edge.js  # 6 edge scenarios
```

## How it works

```
User says "make a Word doc"  ──→  L1 fires (skill PRE-GENERATION CHECK)
                                      │
Agent generates docx file    ──→  Stop hook fires
                                      │
                              Stage 1: grep transcript tail for doc patterns
                                      │ 95% of responses → silent pass
                                      │ 5% hit → check compliance
                                      │
                              Stage 2: check if template was discussed
                                      │ Yes → silent pass
                                      │ No → systemMessage warning
                                      │
Next session starts          ──→  SessionStart hook reads observations.jsonl
                                      │
                              Calculates: "Past 14 days, 40% compliance"
                              → injects additionalContext
                              → Agent starts session already aware
```

## Adding your own rules

Edit `hooks/session-start-compliance-audit.js` → `RULES` object:

```js
const RULES = {
  'my-rule': {
    name: 'My Rule Name',
    triggerPatterns: [/pattern.*that.*indicates.*action/],
    compliancePatterns: [/pattern.*for.*correct.*behavior/],
  },
};
```

One JSON entry per rule. No other changes needed.

## Cost

| | Per response |
|---|---|
| CPU | ~10 ms (Node.js grep) |
| Token | 0 (only a 50-token systemMessage on violation) |
| Dependencies | 0 (Node.js stdlib only) |

## Known Limitations

This is an honest, externally-reviewed assessment. None of these are bugs — they are deliberate design tradeoffs or areas awaiting real-world validation.

| Limitation | Impact | Why it exists |
|---|---|---|
| **Claude Code only** | Hook registration format (`settings.json` SessionStart/Stop) is bound to Claude Code. Cannot be directly ported to Cursor, Codex, or other agent platforms. | Architectural choice, not a bug. The correct cross-platform path is to extract a platform-agnostic rule schema and write per-platform adapters — like ESLint's parser/plugin model. |
| **Cross-turn matching blindspot** | Template discussion in turn 3 + doc generation in turn 99 (outside the 500-line scan window) → L2 may false-positive. | Deliberate. Scanning the full transcript would break the 10ms performance guarantee. Mitigated by non-blocking systemMessage — Claude can judge false positives itself. |
| **L3 depends on observe.sh data pipeline** | SessionStart compliance audit reads `observations.jsonl`. New deployments with no ECC observe.sh history see no data → L3 silently degrades (by design: no data = no false alarms). | The audit script gracefully skips when no data exists. For standalone use, rulehook can record its own observations — this is a planned improvement, not a permanent dependency. |
| **Single real-rule example** | Only `word_templates_choice` has been deployed end-to-end. Pressure testing with 10 synthetic rules proves performance scales, but real-world multi-rule behavior (pattern conflicts, threshold coupling, alert noise) hasn't been validated. | This is the next phase. The RULES object architecture is designed for N rules — but "designed for" ≠ "battle-tested with." |
| **Regex-based detection** | Trigger and compliance patterns are hand-written regular expressions. False negatives occur if the agent expresses the same behavior using different phrasing. | LLM-assisted pattern generation is an obvious next step. The two-stage architecture reserves "Stage 2" for exactly this — swap regex for a focused LLM call when accuracy demands it. |

## File map

| File | Role |
|------|------|
| `hooks/stop-doc-template-check.js` | L2: two-stage transcript audit |
| `hooks/session-start-compliance-audit.js` | L3: historical compliance rate |
| `skills/PRE-GENERATION-CHECK.md` | L1 template snippet |
| `config/settings-snippet.json` | Hook registration example |
| `tests/` | 16+ scenarios, 100% pass |
| `docs/三层防线机制.md` | Full design doc (Chinese) |

## License

MIT
