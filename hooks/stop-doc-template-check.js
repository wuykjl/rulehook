#!/usr/bin/env node
/**
 * Stop Hook: 文档模板偏好检查（两阶段）
 *
 * Stage 1 (bash-level grep, zero token cost):
 *   扫描最近一次响应的 transcript，检测是否生成了 Word/PPT/Excel 文档。
 *   95%+ 的响应不会触发，直接放行。
 *
 * Stage 2 (LLM self-audit, via systemMessage):
 *   如果检测到文档生成操作，检查 transcript 中是否出现了模板偏好讨论。
 *   如果有 → 放行。
 *   如果没有 → 向 Claude 注入 systemMessage，触发自我审计。
 *
 * 规则来源: memory/word_templates_choice.md
 *   "每次生成 Word 文档前，必须询问用户选择模板"
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ────────────────────────────────────────────────────────
const MAX_SCAN_BYTES = 200 * 1024; // 只读最近 200KB（一次响应的量）
const RECENT_LINES = 500;           // 从尾部取最近 N 行

// ── Stage 1 patterns: 文档生成操作 ────────────────────────────────
const DOC_GEN_PATTERNS = [
  // docx-js API calls (JavaScript)
  /\bPacker\.toBuffer\b/,
  /\bDocument\(\s*\{/,
  /\.save\(\s*["'][^"']*\.docx["']/,
  /require\(["']docx["']\)/,
  // python-docx API calls
  /\bdoc\.save\(/,
  /\bDocument\(\)/,
  /from\s+docx\s+import/,
  /python-docx/,
  // Output paths
  /\.docx["'\s`]/,
  /\.docx\b/,
  // Chinese context
  /Word\s*(文档|文件|生成|制作)/,
  /生成.*\.docx/,
  /制作.*Word/,
  // PPT
  /\.pptx\b/,
  /PowerPoint/,
  /幻灯片/,
  /python-pptx/,
  // XLSX
  /\.xlsx\b/,
  /openpyxl/,
  /spreadsheet/,
  // Generics
  /word document/i,
  /generate.*document/i,
];

// ── Stage 2 patterns: 模板偏好已被讨论 ────────────────────────────
const TEMPLATE_DISCUSSED_PATTERNS = [
  /word.templates.choice/i,
  /word_templates_choice/i,
  /Kami.*(风格|模板|样式)/,
  /模板.*(选择|偏好|确认)/,
  /用哪套模板/,
  /默认.*Kami/,
  /template.*preference/i,
  /docx.*template/i,
  /生成.*(前|之前).*(问|确认).*模板/,
  /ask.*(template|模板)/i,
];

// ── Helpers ───────────────────────────────────────────────────────

function readLastBytes(filePath, maxBytes, maxLines) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return '';
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let text = buf.toString('utf8');
    // Take only last N lines
    const lines = text.split('\n');
    if (lines.length > maxLines) {
      text = lines.slice(-maxLines).join('\n');
    }
    return text;
  } catch (e) {
    return '';
  }
}

function anyPatternMatch(text, patterns) {
  for (const p of patterns) {
    if (p.test(text)) return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────

function main() {
  // Read hook input from stdin
  const chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => chunks.push(c));
  process.stdin.on('end', () => {
    const rawInput = chunks.join('');
    let hookInput;

    try {
      hookInput = JSON.parse(rawInput);
    } catch (e) {
      // Can't parse input, pass through
      process.stdout.write(rawInput);
      process.exit(0);
    }

    const transcriptPath = hookInput.transcript_path;
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      process.stdout.write(rawInput);
      process.exit(0);
    }

    // ── Stage 1: grep for document generation ──────────────────
    const recentTranscript = readLastBytes(transcriptPath, MAX_SCAN_BYTES, RECENT_LINES);
    if (!recentTranscript) {
      process.stdout.write(rawInput);
      process.exit(0);
    }

    const hasDocGen = anyPatternMatch(recentTranscript, DOC_GEN_PATTERNS);
    if (!hasDocGen) {
      // No document generation detected → silent pass
      process.stdout.write(rawInput);
      process.exit(0);
    }

    // ── Stage 2: check if template was discussed ────────────────
    const templateDiscussed = anyPatternMatch(recentTranscript, TEMPLATE_DISCUSSED_PATTERNS);
    if (templateDiscussed) {
      // Template was discussed → silent pass
      process.stdout.write(rawInput);
      process.exit(0);
    }

    // ── Violation detected → inject systemMessage ──────────────
    const warning = JSON.stringify({
      continue: true,
      systemMessage: [
        '[文档模板审计] 检测到本次响应生成了 Word/文档类文件，',
        '但 transcript 中未发现模板偏好确认。',
        '规则 word_templates_choice 要求：生成前必须询问用户选择模板（默认 vs Kami 风格）。',
        '如果你确实确认了而此检查误报，请忽略。',
        '如果漏掉了——立刻向用户说明并提供重新生成选项。',
      ].join(''),
    });

    process.stdout.write(warning);
    process.exit(0);
  });
}

main();
