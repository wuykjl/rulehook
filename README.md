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
