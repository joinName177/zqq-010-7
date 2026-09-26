// 解析质量域模型：逐行降级、错误摘要、有效消息保留、分析结果标识

/** 问题严重级别：warning=本行已降级但内容保留；error=本行内容无法恢复而丢失 */
export type IssueSeverity = 'warning' | 'error';

/** 问题分类代码（可枚举、可统计、可本地化展示） */
export type IssueCode =
  | 'unknown-format'      // 行首无法识别为任何已知导出格式
  | 'invalid-timestamp'   // 时间戳字段存在但无法解析
  | 'missing-timestamp'   // 消息缺少时间戳
  | 'malformed-json'      // JSON 行解析失败
  | 'missing-content'     // 消息头存在但正文为空
  | 'encoding-damage'     // 检测到替换字符 � / NUL / BOM 等编码损伤
  | 'truncated-line'      // 行长度超过容量保护，被截断保留
  | 'dangling-header'     // 新消息头出现时，上一条消息没有正文
  | 'synthetic-timeline'; // 全部时间戳缺失，使用合成时间轴（仅用于排序）

export interface ParseIssue {
  /** 问题类别代码 */
  code: IssueCode;
  severity: IssueSeverity;
  /** 原始文件中的行号（从 1 开始），全局类问题为 0 */
  line: number;
  /** 人类可读的问题描述 */
  message: string;
  /** 该行原始内容的截断预览（便于定位，不进入分析引擎） */
  rawPreview?: string;
}

/** 单条消息的来源与质量标记，随消息流入分析引擎 */
export interface MessageQuality {
  /** 来源原始行号（多行消息为首行），用于审计回溯 */
  sourceLines: number[];
  /** 是否来自降级恢复（启发式/延续行拼接），内容仍参与分析但被明确标记 */
  recovered: boolean;
  /** 是否为无法识别格式、作为孤立语料抢救保留的消息 */
  salvaged: boolean;
  /** 时间戳是否为推断/合成而非原文解析所得 */
  syntheticTimestamp: boolean;
  /** 该消息涉及的问题代码（去重） */
  issueCodes: IssueCode[];
}

export type ParseConfidence = 'high' | 'partial' | 'salvage-only';

export interface ParseSummary {
  totalRawLines: number;
  parsedMessages: number;
  /** 结构化头部成功识别的消息数 */
  structuredMessages: number;
  /** 降级恢复保留的消息数（含孤立语料抢救） */
  recoveredMessages: number;
  /** 孤立语料抢救的消息数（recoveredMessages 的子集） */
  salvagedMessages: number;
  droppedLines: number;
  issueCount: number;
  warningCount: number;
  errorCount: number;
  /** 检测到的导出格式标识；未识别为 'unknown' */
  detectedFormats: string[];
  /** 检测到的编码损伤（BOM / 替换字符 / NUL） */
  encodingDamage: boolean;
  /** 有效消息保留率（百分比，四舍五入） */
  retentionRate: number;
  /** 总体可信度标识，驱动分析结果的展示标记 */
  confidence: ParseConfidence;
  /** 是否完全未识别出任何已知格式（进入启发式降级） */
  usedHeuristicFallback: boolean;
  /** 是否使用了合成时间轴 */
  usedSyntheticTimeline: boolean;
  /** 按问题代码聚合的计数表 */
  issuesByCode: Record<string, number>;
}

export interface ParseResult {
  messages: import('./models').ChatMessage[];
  issues: ParseIssue[];
  summary: ParseSummary;
}

/** 进入分析引擎的总体数据质量标识（报告级） */
export type AnalysisQualityFlag = 'high-confidence' | 'degraded' | 'salvage-only';

export interface AnalysisQuality {
  flag: AnalysisQualityFlag;
  confidence: ParseConfidence;
  summary: ParseSummary;
  /** 逐行问题明细（供 UI 展开审计） */
  issues: ParseIssue[];
  /** 分析结论可信度的展示文案 */
  label: string;
  /** 面向使用者的降级说明 */
  notice: string;
}

const ISSUE_LABELS: Record<IssueCode, string> = {
  'unknown-format': '未知格式行',
  'invalid-timestamp': '时间戳无法解析',
  'missing-timestamp': '缺少时间戳',
  'malformed-json': 'JSON 行损坏',
  'missing-content': '空正文消息',
  'encoding-damage': '编码损伤',
  'truncated-line': '超长行截断',
  'dangling-header': '悬空消息头',
  'synthetic-timeline': '合成时间轴'
};

const ISSUE_PREVIEWS: Record<IssueCode, boolean> = {
  'unknown-format': true,
  'malformed-json': true,
  'invalid-timestamp': true,
  'missing-timestamp': false,
  'missing-content': false,
  'encoding-damage': true,
  'truncated-line': true,
  'dangling-header': false,
  'synthetic-timeline': false
};

export function issueLabel(code: IssueCode): string {
  return ISSUE_LABELS[code];
}

/** 错误行（内容丢失）才计为 error；其余降级均为 warning，内容保留 */
export function issueSeverity(code: IssueCode): IssueSeverity {
  return code === 'unknown-format' || code === 'malformed-json' ? 'error' : 'warning';
}

export function issueNeedsPreview(code: IssueCode): boolean {
  return ISSUE_PREVIEWS[code];
}

/** 单行原始内容预览：去除控制字符并截断，防止超长/控制符污染摘要 */
export function previewRaw(raw: string, max = 60): string {
  const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned;
}

/**
 * 根据解析摘要生成分析结果标识。
 * - salvage-only：没有任何结构化消息，全部为抢救语料
 * - degraded：存在错误/降级，但保留了结构化消息
 * - high-confidence：零问题
 */
export function buildAnalysisQuality(summary: ParseSummary, issues: ParseIssue[] = []): AnalysisQuality {
  const flag: AnalysisQualityFlag =
    summary.confidence === 'salvage-only'
      ? 'salvage-only'
      : summary.issueCount > 0
        ? 'degraded'
        : 'high-confidence';

  const labelMap: Record<AnalysisQualityFlag, string> = {
    'high-confidence': '分析结论：完整可信',
    degraded: '分析结论：降级可信（部分数据损坏）',
    'salvage-only': '分析结论：低置信度（格式未识别，仅抢救性分析）'
  };

  const parts: string[] = [];
  parts.push(`原始 ${summary.totalRawLines} 行，保留 ${summary.parsedMessages} 条有效消息（保留率 ${summary.retentionRate}%）`);
  if (summary.recoveredMessages > 0) parts.push(`其中 ${summary.recoveredMessages} 条经降级恢复保留`);
  if (summary.droppedLines > 0) parts.push(`${summary.droppedLines} 行无法恢复已丢弃`);
  if (summary.usedSyntheticTimeline) parts.push('时间轴为推断合成，分层顺序仅供参考');
  if (summary.encodingDamage) parts.push('检测到编码损伤，部分字符可能失真');

  return {
    flag,
    confidence: summary.confidence,
    summary,
    issues,
    label: labelMap[flag],
    notice: parts.join('；')
  };
}
