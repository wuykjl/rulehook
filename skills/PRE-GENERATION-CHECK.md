# PRE-GENERATION CHECK — L1 Prevention Template

Copy this block into the SKILL.md of any document-generation skill
(e.g. `~/.claude/skills/docx/SKILL.md`, `~/.claude/skills/pptx/SKILL.md`).
Insert it **before** the Quick Reference section — as the first thing the
agent reads when the skill is loaded.

## Template

```markdown
## ⚠️ PRE-GENERATION CHECK (MANDATORY — DO NOT SKIP)

**Before writing any document generation code**, you MUST:

1. Read `<memory_path>` — the rule that governs this operation
2. Ask the user: `<checklist question with options>`
3. Wait for user confirmation before proceeding

**Why**: The user has explicitly requested this. Generating without asking wastes time and effort.

**Reference**: `<path-to-style-template-or-config>`
```

## Example (docx + template preference)

```markdown
## ⚠️ PRE-GENERATION CHECK (MANDATORY — DO NOT SKIP)

**Before writing any document generation code**, you MUST:

1. Read `memory/word_templates_choice.md`
2. Ask the user: "用哪套模板？1. 默认（功能全面） 2. Kami 风格（视觉优先）"
3. Wait for user confirmation before proceeding

**Why**: The user has explicitly requested this (2026-06-12).

**Kami 风格规格参考**: `templates/kami-style-demo.js`
```

## How to extend

For each new rule, add a new L1 block to the corresponding skill's SKILL.md:

- `docx` → template preference
- `pptx` → slide template preference
- Any skill that generates files → ask about style/format before generating

The key principle: **put the check BEFORE the code, not in the code.**
