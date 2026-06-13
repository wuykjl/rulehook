#!/usr/bin/env node
/**
 * SessionStart: 历史合规统计分析与上下文注入
 *
 * 扫描所有项目的 observations.jsonl，计算每个规则的近期合规率。
 * 如果某项规则的合规率低于阈值，注入 additionalContext 提醒 Claude。
 *
 * 当前已实现的规则检查:
 *   - doc-template-check: 文档生成前是否确认了模板偏好
 *
 * 架构：纯 Node.js，零 LLM 调用。
 * 输出：符合 SessionStart hook 的 JSON（含 additionalContext）。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── 配置 ────────────────────────────────────────────────────────
const LOOKBACK_DAYS = 14;                // 回溯天数
const COMPLIANCE_WARN_THRESHOLD = 0.85;  // 合规率低于此值 → 警告
const MIN_SESSIONS_FOR_STATS = 3;        // 最少需要几个 session 的数据

// ── 规则定义 ──────────────────────────────────────────────────────
// 每个规则包含: 触发模式(检测"开始了一个需要合规的操作") + 合规模式(检测"合规动作已发生")
const RULES = {
  'doc-template-check': {
    name: 'Word 模板确认',
    memoryRef: 'word_templates_choice.md',
    description: '生成 Word/PPT/Excel 文档前应先询问模板偏好（默认 vs Kami 风格）',
    // 文档生成触发模式
    triggerPatterns: [
      /\.save\(\s*["'][^"']*\.docx["']/,
      /Packer\.toBuffer/,
      /from\s+docx\s+import/,
      /python-docx/,
      /Document\(/,
      /\.pptx\b/,
      /\.xlsx\b/,
      /openpyxl/,
    ],
    // 模板已讨论的合规标记
    compliancePatterns: [
      /模板.*(选择|偏好|确认)|(选择|偏好|确认).*模板/,
      /Kami.*(风格|样式|模板)/,
      /word.templates.choice/i,
      /word_templates_choice/,
      /用哪套模板/,
      /默认.*Kami|Kami.*默认/,
      /template.*pref/i,
    ],
  },
};

// ── 寻找所有 observations.jsonl ───────────────────────────────────

function findObservationFiles() {
  const results = [];
  const searchRoots = [];

  // 1. ECC homunculus 目录
  const homeDir = os.homedir();
  const homunculusCandidates = [
    path.join(homeDir, 'ECC', '.claude', 'homunculus', 'projects'),
    path.join(homeDir, '.claude', 'homunculus', 'projects'),
  ];
  for (const candidate of homunculusCandidates) {
    if (fs.existsSync(candidate)) {
      searchRoots.push(candidate);
    }
  }

  for (const root of searchRoots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const obsFile = path.join(root, entry.name, 'observations.jsonl');
        if (fs.existsSync(obsFile)) {
          results.push({ projectId: entry.name, projectDir: path.join(root, entry.name), filePath: obsFile });
        }
      }
    } catch (e) {
      // directory not readable, skip
    }
  }

  return results;
}

// ── 解析 observations.jsonl ───────────────────────────────────────

function parseObservationsFile(filePath) {
  const lines = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        lines.push(JSON.parse(trimmed));
      } catch (e) {
        // skip malformed lines
      }
    }
  } catch (e) {
    // file not readable
  }
  return lines;
}

// ── 按规则分析 ────────────────────────────────────────────────────

function analyzeRule(ruleId, ruleDef, observations) {
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  // 按 session 分组
  const sessionWindows = new Map();

  for (const obs of observations) {
    const ts = obs.timestamp ? new Date(obs.timestamp).getTime() : 0;
    if (ts < cutoff) continue;

    const sessionId = obs.session || 'unknown';
    if (!sessionWindows.has(sessionId)) {
      sessionWindows.set(sessionId, { triggers: false, complied: false, events: [] });
    }
    const win = sessionWindows.get(sessionId);

    // 检查是否为工具完成事件（output 中包含模式匹配的痕迹）
    if (obs.event === 'tool_complete' && obs.output) {
      const text = typeof obs.output === 'string' ? obs.output : JSON.stringify(obs.output);
      if (ruleDef.triggerPatterns.some(p => p.test(text))) {
        win.triggers = true;
      }
      if (ruleDef.compliancePatterns.some(p => p.test(text))) {
        win.complied = true;
      }
    }

    // 也检查 tool_start 事件的 input
    if (obs.event === 'tool_start' && obs.input) {
      const text = typeof obs.input === 'string' ? obs.input : JSON.stringify(obs.input);
      if (ruleDef.triggerPatterns.some(p => p.test(text))) {
        win.triggers = true;
      }
      if (ruleDef.compliancePatterns.some(p => p.test(text))) {
        win.complied = true;
      }
    }

    win.events.push(obs.tool || '');
  }

  const sessionsWithTrigger = [...sessionWindows.values()].filter(w => w.triggers);
  const sessionsWithCompliance = sessionsWithTrigger.filter(w => w.complied);

  return {
    ruleId,
    ruleName: ruleDef.name,
    totalSessions: sessionWindows.size,
    sessionsWithDocGen: sessionsWithTrigger.length,
    sessionsWithCompliance: sessionsWithCompliance.length,
    complianceRate: sessionsWithTrigger.length > 0
      ? sessionsWithCompliance.length / sessionsWithTrigger.length
      : null,
    recentSessionIds: sessionsWithTrigger.slice(-5).map((_, i, arr) => {
      const keys = [...sessionWindows.keys()];
      const matching = [...sessionWindows.entries()]
        .filter(([, w]) => w.triggers)
        .map(([k]) => k);
      return matching[i] || '';
    }).filter(Boolean),
  };
}

// ── 主逻辑 ────────────────────────────────────────────────────────

function main() {
  // 读取 hook 输入
  let rawInput = '';
  try {
    rawInput = fs.readFileSync(0, 'utf8');
  } catch (e) {
    rawInput = '';
  }

  // 扫描所有观测文件
  const obsFiles = findObservationFiles();
  const allObservations = [];
  for (const { filePath } of obsFiles) {
    allObservations.push(...parseObservationsFile(filePath));
  }

  // 如果没有数据 → 静默通过（无历史数据，无需警告）
  if (allObservations.length === 0) {
    process.stdout.write(rawInput);
    process.exit(0);
  }

  // 分析每条规则
  const results = [];
  for (const [ruleId, ruleDef] of Object.entries(RULES)) {
    results.push(analyzeRule(ruleId, ruleDef, allObservations));
  }

  // 检查是否需要警告
  const warnings = results.filter(r =>
    r.sessionsWithDocGen >= MIN_SESSIONS_FOR_STATS &&
    r.complianceRate !== null &&
    r.complianceRate < COMPLIANCE_WARN_THRESHOLD
  );

  if (warnings.length === 0) {
    // 所有规则合规率良好，或无足够数据 → 静默通过
    process.stdout.write(rawInput);
    process.exit(0);
  }

  // 构造 additionalContext
  const contextLines = [
    '[合规审计] 基于过去 ' + LOOKBACK_DAYS + ' 天的会话数据:',
    '',
  ];

  for (const w of warnings) {
    const rate = (w.complianceRate * 100).toFixed(0);
    contextLines.push(
      `⚠️  ${w.ruleName}: 合规率 ${rate}%（${w.sessionsWithCompliance}/${w.sessionsWithDocGen} 次触发）`
    );
    contextLines.push(`   规则: ${RULES[w.ruleId].description}`);
    contextLines.push(`   记忆文件: memory/${RULES[w.ruleId].memoryRef}`);
  }

  contextLines.push('');
  contextLines.push('建议: 在本次会话中，涉及上述操作时主动确认合规步骤。');

  const output = {
    continue: true,
    additionalContext: contextLines.join('\n'),
  };

  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

main();
