/**
 * Kami-Style Docx Template (第二套模板)
 *
 * 将 Kami 的设计哲学适配到原生 .docx 格式：
 *   - 暖羊皮纸底色 (#F5F4ED)
 *   - 单色强调 (#1B365D 墨蓝)，占比 ≤5%
 *   - 暖调中性灰，禁用冷灰
 *   - Cambria 等线数字（替代 Georgia 的 old-style figures）
 *   - 精确行距控制
 *   - 克制表格样式
 *
 * 输出：原生 .docx，Word/WPS/Google Docs 可编辑
 */

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, TabStopType, TabStopPosition,
  VerticalAlign
} = require('docx');
const fs = require('fs');

// ============================================================
// 设计代币 (Kami-inspired Design Tokens)
// ============================================================
const $ = {
  // --- 色彩 ---
  pageBg:       'F5F4ED',  // 暖羊皮纸（替代纯白）
  inkBlue:      '1B365D',  // 墨蓝 — 唯一强调色
  inkBlueDark:  '0F2340',  // 墨蓝深色（标题）
  warmGrey:     '8B8682',  // 暖灰（次要文字）
  warmDark:     '4A4540',  // 暖深灰（正文）
  warmLight:    'EAE5DE',  // 暖浅灰（表格交替行/卡片底色）
  warmBorder:   'D5CFC7',  // 暖边框
  white:        'FFFFFF',  // 纯白（表头文字）
  accentRed:    'B8453C',  // 暖红（极少量强调数据用）

  // --- 字体 ---
  headingFont:  '楷体',     // 中文标题：楷体（类 Kami 仓耳今楷的书卷气质）
  bodyCN:       '宋体',     // 中文正文：宋体
  bodyEN:       'Cambria',   // 英文/数字：Cambria（等线数字 lining figures，不跳脱）

  // --- 字号（半磅） ---
  sizeHero:     56,   // 28pt 主标题
  sizeTitle:    40,   // 20pt 副标题
  sizeH1:       32,   // 16pt
  sizeH2:       28,   // 14pt
  sizeH3:       24,   // 12pt
  sizeBody:     22,   // 11pt
  sizeSmall:    18,   // 9pt
  sizeCaption:  16,   // 8pt

  // --- 间距（twips）---
  marginPage:   1440,      // 1 inch 页边距
  spaceH1Before: 480,     // H1 段前
  spaceH1After:  200,     // H1 段后
  spaceH2Before: 360,
  spaceH2After:  160,
  spaceH3Before: 240,
  spaceH3After:  120,
  spaceBodyAfter: 140,    // 正文段后

  // --- 行距（240ths of a line）---
  lineHeading:  276,  // 1.15（标题紧凑）
  lineBody:     360,  // 1.50（正文阅读舒适）

  // --- A4 纸（默认）---
  pageW: 11906,
  pageH: 16838,
  contentW: 9026,   // 11906 - 2*1440
};

// ============================================================
// 辅助函数
// ============================================================

/** 标题 */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: $.spaceH1Before, after: $.spaceH1After, line: $.lineHeading },
    children: [new TextRun({ text, font: $.headingFont, size: $.sizeH1, bold: true, color: $.inkBlue })],
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: $.spaceH2Before, after: $.spaceH2After, line: $.lineHeading },
    children: [new TextRun({ text, font: $.headingFont, size: $.sizeH2, bold: true, color: $.inkBlue })],
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: $.spaceH3Before, after: $.spaceH3After, line: $.lineHeading },
    children: [new TextRun({ text, font: $.headingFont, size: $.sizeH3, bold: true, color: $.inkBlue })],
  });
}

/** 正文段落 */
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: $.spaceBodyAfter, line: $.lineBody, ...(opts.spacing || {}) },
    alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [
      new TextRun({
        text,
        font: { ascii: $.bodyEN, eastAsia: $.bodyCN, hAnsi: $.bodyEN },
        size: opts.size || $.sizeBody,
        color: opts.color || $.warmDark,
        italics: opts.italics || false,
        bold: opts.bold || false,
      }),
    ],
  });
}

/** 居中装饰线 */
function divider(color, size = 6) {
  const c = color || $.inkBlue;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size, color: c, space: 1 } },
    children: [],
  });
}

/** 统一的细边框 */
function cellBorders(color) {
  const c = color || $.warmBorder;
  const s = { style: BorderStyle.SINGLE, size: 1, color: c };
  return { top: s, bottom: s, left: s, right: s };
}

/** 空行 */
function spacer(twips = 200) {
  return new Paragraph({ spacing: { before: twips }, children: [] });
}

/** 统计数字卡片 */
function statCell(label, value, colWidth) {
  return new TableCell({
    borders: cellBorders($.warmBorder),
    width: { size: colWidth, type: WidthType.DXA },
    shading: { fill: $.pageBg, type: ShadingType.CLEAR },
    margins: { top: 140, bottom: 140, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new TextRun({ text: value, font: $.bodyEN, size: 52, bold: true, color: $.inkBlue })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
        children: [new TextRun({ text: label, font: $.bodyCN, size: $.sizeSmall, color: $.warmGrey })],
      }),
    ],
  });
}

// ============================================================
// 数据表格构建
// ============================================================
function buildBatchTable() {
  const data = [
    ['第一批',   '2019.09', '25', '52%', '4+7 试点扩围'],
    ['第二批',   '2020.01', '32', '53%', '全国推开'],
    ['第三批',   '2020.08', '55', '53%', '纳入注射剂'],
    ['第四批',   '2021.02', '45', '52%', '竞争加剧'],
    ['第五批',   '2021.06', '61', '56%', '规模最大批次'],
    ['第六批',   '2022.07', '16', '48%', '胰岛素专项'],
    ['第七批',   '2022.07', '60', '48%', '含中成药试点'],
    ['第八批',   '2023.03', '39', '56%', '含生物类似药'],
    ['第九批',   '2023.11', '41', '58%', '规则优化'],
    ['第十批',   '2024.12', '62', '—',   '数据待更新'],
    ['第十一批', '2025.10', '55', '—',   '含创新药'],
  ];

  const colW = [1500, 1200, 900, 900, 4526]; // sum = 9026 = contentW
  const headerB = cellBorders($.inkBlue);
  const dataB = cellBorders($.warmBorder);

  // 表头行
  const headerLabels = ['批次', '执行时间', '品种数', '平均降幅', '备注'];
  const headerCells = headerLabels.map((label, i) => new TableCell({
    borders: headerB,
    width: { size: colW[i], type: WidthType.DXA },
    shading: { fill: $.inkBlue, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: label, font: $.headingFont, size: $.sizeSmall, bold: true, color: $.white })],
      }),
    ],
  }));

  // 数据行
  const dataRows = data.map((row, ri) => {
    const isAlt = ri % 2 === 1;
    return new TableRow({
      children: row.map((cell, ci) => {
        const isNum = ci === 2 || ci === 3;
        const isHighlight = ci === 3 && cell !== '—' && !cell.includes('待');
        return new TableCell({
          borders: dataB,
          width: { size: colW[ci], type: WidthType.DXA },
          shading: isAlt ? { fill: $.warmLight, type: ShadingType.CLEAR } : { fill: $.white, type: ShadingType.CLEAR },
          margins: { top: 70, bottom: 70, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: ci < 4 ? AlignmentType.CENTER : AlignmentType.LEFT,
              children: [new TextRun({
                text: cell,
                font: isNum ? $.bodyEN : $.bodyCN,
                size: $.sizeBody,
                color: isHighlight ? $.accentRed : $.warmDark,
                bold: isHighlight,
              })],
            }),
          ],
        });
      }),
    });
  });

  return new Table({
    width: { size: $.contentW, type: WidthType.DXA },
    columnWidths: colW,
    rows: [new TableRow({ children: headerCells }), ...dataRows],
  });
}

// ============================================================
// 构建完整文档
// ============================================================
function buildDocument() {
  return new Document({
    styles: {
      default: {
        document: {
          run: {
            font: $.bodyCN,
            size: $.sizeBody,
            color: $.warmDark,
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: $.sizeH1, bold: true, font: $.headingFont, color: $.inkBlue },
          paragraph: { spacing: { before: $.spaceH1Before, after: $.spaceH1After, line: $.lineHeading }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: $.sizeH2, bold: true, font: $.headingFont, color: $.inkBlue },
          paragraph: { spacing: { before: $.spaceH2Before, after: $.spaceH2After, line: $.lineHeading }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: $.sizeH3, bold: true, font: $.headingFont, color: $.inkBlue },
          paragraph: { spacing: { before: $.spaceH3Before, after: $.spaceH3After, line: $.lineHeading }, outlineLevel: 2 },
        },
      ],
    },

    sections: [{
      properties: {
        page: {
          size: { width: $.pageW, height: $.pageH },
          margin: {
            top: $.marginPage,
            right: $.marginPage,
            bottom: $.marginPage,
            left: $.marginPage,
          },
        },
      },

      // ---- 页眉 ----
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              spacing: { after: 0 },
              border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: $.warmBorder, space: 6 } },
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              children: [
                new TextRun({ text: '药品集采数据分析', font: $.bodyCN, size: $.sizeCaption, color: $.warmGrey }),
                new TextRun({ text: '\t', font: $.bodyEN, size: $.sizeCaption }),
                new TextRun({ text: '2025 年度报告', font: { ascii: $.bodyEN, eastAsia: $.bodyCN }, size: $.sizeCaption, color: $.warmGrey }),
              ],
            }),
          ],
        }),
      },

      // ---- 页脚 ----
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0 },
              border: { top: { style: BorderStyle.SINGLE, size: 1, color: $.warmBorder, space: 6 } },
              children: [
                new TextRun({ text: '— ', font: $.bodyEN, size: $.sizeCaption, color: $.warmGrey }),
                new TextRun({ children: [PageNumber.CURRENT], font: $.bodyEN, size: $.sizeCaption, color: $.warmGrey }),
                new TextRun({ text: ' —', font: $.bodyEN, size: $.sizeCaption, color: $.warmGrey }),
              ],
            }),
          ],
        }),
      },

      // ---- 正文内容 ----
      children: [

        // ===== 封面标题区 =====
        spacer(600),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40, line: $.lineHeading },
          children: [
            new TextRun({ text: '国家组织药品集中采购', font: $.headingFont, size: $.sizeHero, bold: true, color: $.inkBlueDark }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 20, line: $.lineHeading },
          children: [
            new TextRun({ text: '中选结果数据分析报告', font: $.headingFont, size: $.sizeTitle, color: $.inkBlue }),
          ],
        }),

        // 装饰线
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: $.inkBlue, space: 1 } },
          children: [],
        }),

        // 元信息
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 480 },
          children: [
            new TextRun({
              text: '报告日期：2025 年 6 月  ·  数据来源：国家医保局、各省医保局  ·  覆盖批次：第 1–11 批',
              font: { ascii: $.bodyEN, eastAsia: $.bodyCN },
              size: $.sizeSmall,
              color: $.warmGrey,
            }),
          ],
        }),

        // ===== 关键指标卡片 =====
        new Table({
          width: { size: $.contentW, type: WidthType.DXA },
          columnWidths: [2256, 2256, 2257, 2257],
          rows: [
            new TableRow({
              children: [
                statCell('累计采购批次', '11', 2256),
                statCell('涉及药品品种', '420+', 2256),
                statCell('中选企业总数', '580+', 2257),
                statCell('平均降价幅度', '53%', 2257),
              ],
            }),
          ],
        }),

        // ===== 一、概述 =====
        spacer(480),
        h1('一、概述'),
        p('国家组织药品集中采购（简称"国家集采"）是由国家医疗保障局主导的药品价格谈判与采购机制。核心逻辑是"以量换价"——由政府代表全国公立医疗机构集中谈判，用确定的采购量换取企业大幅降价。'),
        p('自 2019 年第一批集采（4+7 试点）落地以来，已累计完成 11 个批次，覆盖化学药、生物药、胰岛素、中成药等多个品类。中选药品平均降价幅度超过 50%，累计为患者和医保基金节省药品费用超过 4,000 亿元。'),
        p('本报告基于官方公开的采购文件 PDF，通过 OCR 识别与结构化解析技术提取关键数据，对各批次的中选结果、企业分布、价格趋势进行了系统性梳理与分析。数据截止日期为 2025 年 6 月。', { italics: true, color: $.warmGrey }),

        // ===== 二、各批次数据 =====
        spacer(360),
        h2('二、各批次核心数据'),
        p('下表汇总了第 1–11 批国家集采的关键指标。降幅数据来自国家医保局官方公告；第十批与第十一批的平均降幅截至报告日尚未正式公布。'),

        spacer(160),
        buildBatchTable(),

        // 表格脚注
        new Paragraph({
          spacing: { before: 80, after: 0 },
          children: [
            new TextRun({
              text: '注：降幅数据为官方公告口径。第六批（胰岛素专项）以降幅区间替代均值。',
              font: $.bodyCN,
              size: $.sizeCaption,
              color: $.warmGrey,
              italics: true,
            }),
          ],
        }),

        // ===== 三、趋势洞察 =====
        spacer(400),
        h2('三、趋势与洞察'),

        h3('3.1  品种规模持续扩大'),
        p('从第一批的 25 个品种到第十一批的 55 个品种，覆盖范围显著扩展。特别是第六批胰岛素专项的纳入，标志着集采从化学药向生物药的战略性跨越。第十批更是以 62 个品种创下单批采购规模新高。'),

        h3('3.2  价格降幅趋于稳定'),
        p('前五批降幅在 52%–56% 之间波动，后续批次维持在 48%–58% 区间。这说明价格发现机制已相对成熟——企业报价策略趋于理性，医保局的测算模型也更加精准，市场进入稳定博弈阶段。'),

        h3('3.3  企业集中度提升'),
        p('头部药企凭借规模优势和成本控制能力，在多批次中持续中选。TOP 20 企业累计中选次数占总记录的 35% 以上。同时，部分企业因无法达到量价要求而退出，行业集中度呈现加速提升的趋势。'),

        h3('3.4  质量监管常态化'),
        p('从第四批开始，已有多家企业因 GMP 不合规、抽检不合格等原因被取消中选资格。国家医保局与药监局建立了跨部门联动机制，药品质量的持续性监管已成为集采制度的标配环节。'),

        // ===== 四、数据来源 =====
        spacer(480),
        h2('四、数据来源与方法'),
        p('本报告数据来源于以下渠道：'),
        p('1. 国家医保局官方网站（nhsa.gov.cn）发布的各批次中选结果公告；', { spacing: { after: 60 } }),
        p('2. 各省医保局官网公示的中选企业及品种清单；', { spacing: { after: 60 } }),
        p('3. 上海阳光医药采购网（smpaa.cn）发布的采购文件 PDF 原件；', { spacing: { after: 60 } }),
        p('4. PDF 文件通过 pdfplumber 自动解析，辅以 OCR 识别与人工交叉校验。', { spacing: { after: 60 } }),

        // ===== 页尾 =====
        spacer(600),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 2, color: $.warmBorder, space: 10 } },
          spacing: { before: 200 },
          children: [
            new TextRun({ text: '本报告由 AI 辅助生成，数据仅供参考。正式引用请以国家医保局官方公布为准。', font: $.bodyCN, size: $.sizeCaption, color: $.warmGrey, italics: true }),
          ],
        }),
      ],
    }],
  });
}

// ============================================================
// 生成并保存
// ============================================================
const OUTPUT = 'C:/Users/wuyu/Downloads/Kami风格示例_药品集采报告.docx';

async function main() {
  try {
    const doc = buildDocument();
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(OUTPUT, buffer);
    console.log(`✅ 文档已生成: ${OUTPUT}`);
    console.log(`   文件大小: ${(buffer.length / 1024).toFixed(1)} KB`);
  } catch (err) {
    console.error('❌ 生成失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
