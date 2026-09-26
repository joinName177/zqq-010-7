import { ChatMessage } from '../core/models';
import {
  ParseIssue,
  ParseResult,
  ParseSummary,
  IssueCode,
  issueSeverity,
  issueNeedsPreview,
  previewRaw
} from '../core/parse-quality';
import { ChatParserPort } from '../ports/chat-parser.port';

/** 容量保护：单行超过该长度时截断保留（防止单行文本撑爆下游统计） */
const MAX_LINE_LENGTH = 20000;
/** 错误明细最多保留条数（摘要计数不受影响），防止巨量坏行淹没 UI */
const MAX_STORED_ISSUES = 200;

// 日期前缀（支持 - / . 分隔、时间可省秒）
const DATE_PREFIX = String.raw`\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?`;
// 短信/通用导出：[2023-08-12 21:04:12] 张三: 内容（方括号可选，冒号中英文均可）
const BRACKET_HEADER = new RegExp(String.raw`^\[?(${DATE_PREFIX})\]?\s+([^:：]+)[：:]\s?(.*)$`);
// QQ 导出：2023-08-12 21:04:12 张三(123456) 或 张三<123456>，内联正文可选
const QQ_HEADER = new RegExp(String.raw`^(${DATE_PREFIX})\s+(.*?)\s*[(<]\d+[)>]\s*(.*)$`);
// 微信导出：2023-08-12 21:04:12 张三（行尾无冒号）
const WECHAT_HEADER = new RegExp(String.raw`^(${DATE_PREFIX})\s+(\S.*?)$`);
const DATE_HINT = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/;
const HEURISTIC_SPLIT = /^\s*([^:：]{1,30})[：:]\s*([\s\S]+)$/;

const JSON_SENDER_KEYS = ['sender', 'from', 'user', 'name', 'author', 'talker'];
const JSON_CONTENT_KEYS = ['content', 'message', 'text', 'body', 'msg'];
const JSON_TIME_KEYS = ['timestamp', 'time', 'date', 'datetime', 'createTime'];
const FORMAT_LABELS: Record<string, string> = {
  bracket: '短信/通用文本',
  qq: 'QQ 导出',
  wechat: '微信导出',
  json: 'JSON 结构化'
};

/** 解析管道内的暂存消息（尚未决定时间戳与最终标记） */
interface PendingMessage {
  contentParts: string[];
  sourceLines: number[];
  sender: string | null;
  timestamp: Date | null;
  timestampValid: boolean;
  headerFormat: string | null;
  /** 头部声明了内联/后续正文之外的问题（如空正文、坏时间戳） */
  issueCodes: IssueCode[];
  /** 是否由无法识别行抢救而来（孤立语料） */
  salvaged: boolean;
  /** 结构化解析的消息（命中过头部或合法 JSON） */
  structured: boolean;
}

type HeaderHit =
  | { kind: 'bracket' | 'qq' | 'wechat'; ts: string; sender: string; inline: string; format: string }
  | null;

export class UniversalChatParserAdapter implements ChatParserPort {
  async parse(rawText: string): Promise<ParseResult> {
    return parseChat(rawText);
  }
}

/**
 * 纯函数解析器（便于单测）。逐行处理，每行独立 try/catch，
 * 任何一行的异常都不会中断整体解析。
 */
export function parseChat(rawText: string): ParseResult {
  const issues: ParseIssue[] = [];
  const detectedFormats = new Set<string>();
  let encodingDamage = false;
  let totalRawLines = 0;
  let nonBlankLines = 0;
  let droppedCount = 0;

  const recordIssue = (code: IssueCode, line: number, message: string, rawLine?: string) => {
    if (issues.length < MAX_STORED_ISSUES) {
      issues.push({
        code,
        severity: issueSeverity(code),
        line,
        message,
        rawPreview: issueNeedsPreview(code) && rawLine !== undefined ? previewRaw(rawLine) : undefined
      });
    }
  };

  let text = rawText ?? '';
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
    encodingDamage = true;
    recordIssue('encoding-damage', 0, '文件开头存在 BOM 标记，已自动移除');
  }
  if (text.includes('�') || text.includes('\x00')) {
    encodingDamage = true;
  }

  // 整个文件是单个 JSON 数组/对象时，按结构化记录解析（每行问题仍逐条登记）
  const bulk = tryParseBulkJson(text);
  if (bulk) {
    return buildResult(bulk.messages, bulk.issues, {
      totalRawLines: text.split(/\r?\n/).length,
      // 批量 JSON 的“行”口径为记录条数，而非物理换行数
      nonBlankLines: bulk.totalRecords,
      droppedCount: bulk.droppedCount,
      detectedFormats: new Set(['json']),
      encodingDamage,
      usedHeuristicFallback: false,
      usedSyntheticTimeline: bulk.usedSyntheticTimeline
    });
  }

  const rawLines = text.split(/\r?\n/);
  const messages: PendingMessage[] = [];

  let pending: PendingMessage | null = null;

  const startPending = (lineNo: number): PendingMessage => {
    const p: PendingMessage = {
      contentParts: [],
      sourceLines: [lineNo],
      sender: null,
      timestamp: null,
      timestampValid: false,
      headerFormat: null,
      issueCodes: [],
      salvaged: false,
      structured: false
    };
    pending = p;
    return p;
  };

  const flush = () => {
    if (pending) {
      messages.push(pending);
      pending = null;
    }
  };

  rawLines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const isBlank = rawLine.trim().length === 0;
    if (!isBlank) {
      totalRawLines++;
      nonBlankLines++;
    }

    try {
      // —— 空行：多行消息内视为软换行保留，行首空行直接跳过 ——
      if (isBlank) {
        if (pending && pending.contentParts.length > 0) pending.contentParts.push('');
        return;
      }

      let line = rawLine;

      if (line.includes('�') || line.includes('\x00')) {
        recordIssue('encoding-damage', lineNo, '本行含替换字符 � 或空字节，已尽力清洗保留', line);
        line = line.replace(/\x00/g, '').replace(/�/g, '');
        if (line.trim().length === 0) {
          recordIssue('missing-content', lineNo, '本行清洗编码损伤后无剩余内容，已丢弃');
          droppedCount++;
          return;
        }
      }

      if (line.length > MAX_LINE_LENGTH) {
        recordIssue('truncated-line', lineNo, `本行超长（${line.length} 字符），截断为 ${MAX_LINE_LENGTH} 字符后保留`, line);
        line = line.slice(0, MAX_LINE_LENGTH);
      }

      // —— JSON 行：合法则独立成条；合法但无正文则跳过；损坏则清洗后抢救，绝不静默丢弃 ——
      if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
        const jsonResult = parseJsonLine(line.trim(), lineNo, recordIssue);
        if (jsonResult === 'empty') {
          // 合法 JSON 但无正文字段：已登记 missing-content，整行丢弃
          droppedCount++;
          return;
        }
        if (jsonResult) {
          flush();
          detectedFormats.add('json');
          const p = startPending(lineNo);
          p.structured = true;
          p.headerFormat = 'json';
          p.sender = jsonResult.sender;
          p.timestamp = jsonResult.timestamp;
          p.timestampValid = jsonResult.timestampValid;
          p.contentParts.push(jsonResult.content);
          if (!jsonResult.timestampValid) {
            p.issueCodes.push(jsonResult.timestamp === null ? 'missing-timestamp' : 'invalid-timestamp');
          }
          flush();
          return;
        }
        // JSON 损坏：落入下方行处理，清洗掉括号后作为语料抢救
        line = line.trim().replace(/^\{+/, '').replace(/\}+$/, '');
        if (!pending) startPending(lineNo);
        pending!.salvaged = true;
        pending!.sourceLines.push(lineNo);
        pending!.contentParts.push(line);
        return;
      }

      // —— 已知导出格式头部 ——
      const header = matchHeader(line);
      if (header) {
        const tsDate = parseTimestamp(header.ts);
        if (!tsDate) {
          // 有日期外形却无法解析：登记错误，行内容作为孤立语料保留，不丢失消息
          recordIssue('invalid-timestamp', lineNo, `时间戳“${header.ts}”无法解析，内容已抢救保留`, line);
          if (!pending) startPending(lineNo);
          pending!.salvaged = true;
          pending!.issueCodes.push('invalid-timestamp');
          pending!.sourceLines.push(lineNo);
          pending!.contentParts.push(line);
          return;
        }

        // 上一条只有头部、没有正文：登记后丢弃空头，新消息正常开始
        if (pending && pending.contentParts.join('\n').trim().length === 0) {
          recordIssue(
            'dangling-header',
            pending.sourceLines[0],
            `发送者“${pending.sender ?? '未知'}”的消息缺少正文，已跳过该空消息`
          );
          droppedCount++;
          pending = null;
        } else {
          flush();
        }

        detectedFormats.add(header.format);
        const p = startPending(lineNo);
        p.structured = true;
        p.headerFormat = header.format;
        p.sender = header.sender;
        p.timestamp = tsDate;
        p.timestampValid = true;
        if (header.inline.trim()) p.contentParts.push(header.inline.trim());
        return;
      }

      // —— 普通延续行，或未知格式行 ——
      if (pending) {
        pending.sourceLines.push(lineNo);
        pending.contentParts.push(line);
        return;
      }

      // 文件开头没有任何头部：作为孤立语料抢救，绝不静默丢失
      recordIssue('unknown-format', lineNo, '无法识别的行格式（缺少时间戳/发送者头部），内容已抢救保留', line);
      const p = startPending(lineNo);
      p.salvaged = true;
      p.issueCodes.push('unknown-format');
      p.contentParts.push(line);
    } catch {
      // 兜底：任何意外异常都隔离在本行，其余行继续解析；该行确实无法保留，计入丢弃
      recordIssue('unknown-format', lineNo, '本行解析时发生意外错误，已隔离跳过（不影响其余行）', rawLine);
      droppedCount++;
    }
  });

  flush();

  // 尾部空头消息
  const last = messages[messages.length - 1];
  if (last && last.contentParts.join('\n').trim().length === 0) {
    recordIssue('dangling-header', last.sourceLines[0], `发送者“${last.sender ?? '未知'}”的消息缺少正文，已跳过该空消息`);
    droppedCount++;
    messages.pop();
  }

  const anyStructure = messages.some(m => m.structured);
  const usedHeuristicFallback = !anyStructure;

  let finalized: PendingMessage[];
  if (usedHeuristicFallback) {
    // 全文无结构：启发式按 “发送者: 正文” 抢救切分，标记为低置信度
    finalized = heuristicSalvage(rawLines, recordIssue);
  } else {
    finalized = messages;
  }

  const usedSyntheticTimeline = fillTimestamps(finalized, recordIssue);
  const chatMessages = finalized.map((p, i) => toChatMessage(p, i + 1));

  return buildResult(chatMessages, issues, {
    totalRawLines: rawLines.length,
    nonBlankLines,
    droppedCount,
    detectedFormats,
    encodingDamage,
    usedHeuristicFallback,
    usedSyntheticTimeline
  });
}

interface JsonLineResult {
  sender: string;
  content: string;
  timestamp: Date | null;
  timestampValid: boolean;
}

type JsonLineOutcome = JsonLineResult | 'empty' | null;

function parseJsonLine(
  line: string,
  lineNo: number,
  recordIssue: (code: IssueCode, line: number, message: string, rawLine?: string) => void
): JsonLineOutcome {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    recordIssue('malformed-json', lineNo, 'JSON 行无法解析，已剥离 JSON 外壳后抢救内容', line);
    return null;
  }

  const content = firstString(obj, JSON_CONTENT_KEYS);
  if (!content) {
    recordIssue('missing-content', lineNo, 'JSON 记录缺少正文字段，已跳过该记录');
    return 'empty';
  }

  const sender = firstString(obj, JSON_SENDER_KEYS) ?? '未知者';
  const rawTs = firstString(obj, JSON_TIME_KEYS) ?? obj[JSON_TIME_KEYS[0]];
  if (rawTs === undefined || rawTs === null || rawTs === '') {
    return { sender, content, timestamp: null, timestampValid: false };
  }
  const ts = typeof rawTs === 'number' ? new Date(rawTs) : new Date(String(rawTs));
  if (isNaN(ts.getTime())) {
    return { sender, content, timestamp: null, timestampValid: false };
  }
  return { sender, content, timestamp: ts, timestampValid: true };
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function matchHeader(line: string): HeaderHit {
  const b = line.match(BRACKET_HEADER);
  if (b) return { kind: 'bracket', ts: b[1], sender: b[2].trim(), inline: b[3] ?? '', format: 'bracket' };
  const q = line.match(QQ_HEADER);
  if (q) return { kind: 'qq', ts: q[1], sender: q[2].trim(), inline: q[3] ?? '', format: 'qq' };
  // 微信头部必须以日期开头，避免把普通对话行误判为头部
  if (DATE_HINT.test(line)) {
    const w = line.match(WECHAT_HEADER);
    if (w) {
      const rest = w[2].trim();
      if (rest.length > 0) return { kind: 'wechat', ts: w[1], sender: rest, inline: '', format: 'wechat' };
    }
  }
  return null;
}

/** 将 “YYYY-M-D[ T]H:M[:S]” 统一作为本地时间解析，避免浏览器对分隔符的差异 */
function parseTimestamp(raw: string): Date | null {
  const m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? 0);

  // 严格范围校验：JS Date 会把 99 月 / 32 日进位回绕，必须显式拒绝
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const d = new Date(year, month - 1, day, hour, minute, second);
  // 回绕校验：2 月 31 日等非法日历日期会被 Date 进位，需与输入分量一致
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute ||
    d.getSeconds() !== second
  ) {
    return null;
  }
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 时间戳补全（仅用于排序与展示）：
 * - 缺失/非法时间戳的消息继承前一条有效时间；
 * - 位于开头者向后借用第一条有效时间并逐秒前移；
 * - 全文无有效时间则以当前时间为锚点合成，并登记 synthetic-timeline。
 * 返回是否使用了合成时间轴。
 */
function fillTimestamps(
  pending: PendingMessage[],
  recordIssue: (code: IssueCode, line: number, message: string) => void
): boolean {
  const validIdx = pending.findIndex(p => p.timestampValid && p.timestamp);
  let syntheticAll = false;

  if (validIdx === -1) {
    syntheticAll = true;
    const anchor = Date.now();
    pending.forEach((p, i) => {
      p.timestamp = new Date(anchor - (pending.length - i) * 86400000 * 3);
      p.issueCodes.push('synthetic-timeline');
    });
    recordIssue('synthetic-timeline', 0, '全部消息均缺少可识别时间戳，已合成顺序时间轴（每 3 天一条），分层时间仅供参考');
    return syntheticAll;
  }

  // 向前填充
  const firstValid = pending[validIdx].timestamp!;
  for (let i = validIdx - 1; i >= 0; i--) {
    if (pending[i].timestampValid && pending[i].timestamp) continue;
    const base = pending[i + 1].timestamp!;
    pending[i].timestamp = new Date(base.getTime() - 1000);
    pending[i].issueCodes.push('missing-timestamp');
  }
  // 向后填充
  for (let i = 0; i < pending.length; i++) {
    if (pending[i].timestampValid && pending[i].timestamp) continue;
    if (i === 0) {
      pending[i].timestamp = new Date(firstValid.getTime() - 1000);
    } else {
      pending[i].timestamp = new Date(pending[i - 1].timestamp!.getTime() + 1000);
    }
    pending[i].issueCodes.push('missing-timestamp');
  }
  return syntheticAll;
}

/** 全文未识别任何结构时的启发式抢救：仍逐行隔离，保留全部非空行 */
function heuristicSalvage(
  rawLines: string[],
  recordIssue: (code: IssueCode, line: number, message: string, rawLine?: string) => void
): PendingMessage[] {
  const out: PendingMessage[] = [];
  rawLines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.replace(/\x00/g, '').replace(/�/g, '').trim();
    if (!line) return;

    const p: PendingMessage = {
      contentParts: [],
      sourceLines: [lineNo],
      sender: null,
      timestamp: null,
      timestampValid: false,
      headerFormat: null,
      issueCodes: ['unknown-format'],
      salvaged: true,
      structured: false
    };

    const m = line.match(HEURISTIC_SPLIT);
    if (m && m[1].trim().length <= 20) {
      p.sender = m[1].trim();
      p.contentParts.push(m[2].trim());
    } else {
      p.sender = out.length % 2 === 0 ? '挖掘目标A' : '挖掘目标B';
      p.contentParts.push(line);
    }
    out.push(p);
  });

  recordIssue(
    'unknown-format',
    0,
    '文件未命中任何已知导出格式（微信/QQ/短信/JSON），已按“发送者: 正文”启发式抢救全部内容，结论为低置信度'
  );
  return out;
}

function toChatMessage(p: PendingMessage, seq: number): ChatMessage {
  const content = p.contentParts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const issueCodes = [...new Set(p.issueCodes)];
  return {
    id: `msg-${seq}`,
    timestamp: p.timestamp ?? new Date(),
    sender: p.sender ?? '未知者',
    content,
    sentimentScore: 0,
    wordCount: content.length,
    quality: {
      sourceLines: p.sourceLines,
      recovered: !p.structured || issueCodes.length > 0,
      salvaged: p.salvaged,
      syntheticTimestamp: !p.timestampValid || issueCodes.includes('synthetic-timeline'),
      issueCodes
    }
  };
}

interface BulkResult {
  messages: ChatMessage[];
  issues: ParseIssue[];
  usedSyntheticTimeline: boolean;
  totalRecords: number;
  droppedCount: number;
}

/** 整个文件为 JSON 数组（或 {messages:[...]}）时的批量解析 */
function tryParseBulkJson(text: string): BulkResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) {
    return null;
  }
  let arr: unknown;
  try {
    arr = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;

  const issues: ParseIssue[] = [];
  const record = (code: IssueCode, line: number, message: string) =>
    issues.push({ code, severity: issueSeverity(code), line, message });

  const pendings: PendingMessage[] = [];
  let droppedCount = 0;
  arr.forEach((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      record('unknown-format', idx + 1, `第 ${idx + 1} 条记录不是对象，已跳过`);
      droppedCount++;
      return;
    }
    const obj = item as Record<string, unknown>;
    const content = firstString(obj, JSON_CONTENT_KEYS);
    if (!content) {
      record('missing-content', idx + 1, `第 ${idx + 1} 条记录缺少正文字段，已跳过`);
      droppedCount++;
      return;
    }
    const sender = firstString(obj, JSON_SENDER_KEYS) ?? '未知者';
    const rawTs = firstString(obj, JSON_TIME_KEYS);
    let ts: Date | null = null;
    let timeCode: IssueCode | null = null;
    if (rawTs === null) {
      timeCode = 'missing-timestamp';
    } else {
      const parsed = new Date(rawTs);
      if (isNaN(parsed.getTime())) {
        timeCode = 'invalid-timestamp';
        record('invalid-timestamp', idx + 1, `第 ${idx + 1} 条记录时间戳“${rawTs}”无法解析，已补全排序时间`);
      } else {
        ts = parsed;
      }
    }
    pendings.push({
      contentParts: [content],
      sourceLines: [idx + 1],
      sender,
      timestamp: ts,
      timestampValid: ts !== null,
      headerFormat: 'json',
      issueCodes: timeCode ? [timeCode] : [],
      salvaged: false,
      structured: true
    });
  });

  const usedSyntheticTimeline = fillTimestamps(pendings, record);
  return {
    messages: pendings.map((p, i) => toChatMessage(p, i + 1)),
    issues,
    usedSyntheticTimeline,
    totalRecords: arr.length,
    droppedCount
  };
}

interface BuildContext {
  totalRawLines: number;
  nonBlankLines: number;
  /** 明确不可恢复而丢弃的行/记录数（在解析过程中逐处累加） */
  droppedCount: number;
  detectedFormats: Set<string>;
  encodingDamage: boolean;
  usedHeuristicFallback: boolean;
  usedSyntheticTimeline: boolean;
}

function buildResult(messages: ChatMessage[], issues: ParseIssue[], ctx: BuildContext): ParseResult {
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const errorCount = issues.filter(i => i.severity === 'error').length;

  // 覆盖行：被至少一条保留消息吸收的原始行（有效消息保留口径）
  const coveredLines = new Set<number>();
  for (const m of messages) {
    for (const ln of m.quality?.sourceLines ?? []) {
      if (ln > 0) coveredLines.add(ln);
    }
  }

  const structuredMessages = messages.filter(m => m.quality && !m.quality.recovered).length;
  const recoveredMessages = messages.filter(m => m.quality?.recovered).length;
  const salvagedMessages = messages.filter(m => m.quality?.salvaged).length;

  const droppedLines = ctx.droppedCount;

  const issuesByCode: Record<string, number> = {};
  for (const issue of issues) {
    issuesByCode[issue.code] = (issuesByCode[issue.code] ?? 0) + 1;
  }

  // 保留率：有效消息覆盖的原始非空行 / 全部非空行
  const nonBlankTotal = Math.max(1, ctx.nonBlankLines);
  const retentionRate = Math.round((coveredLines.size / nonBlankTotal) * 100);

  const confidence: ParseSummary['confidence'] =
    messages.length === 0
      ? 'salvage-only'
      : structuredMessages === 0
        ? 'salvage-only'
        : issues.length === 0
          ? 'high'
          : 'partial';

  const formats = [...ctx.detectedFormats].map(f => FORMAT_LABELS[f] ?? f);

  return {
    messages,
    issues,
    summary: {
      totalRawLines: ctx.totalRawLines,
      parsedMessages: messages.length,
      structuredMessages,
      recoveredMessages,
      salvagedMessages,
      droppedLines,
      issueCount: issues.length,
      warningCount,
      errorCount,
      detectedFormats: formats.length ? formats : ['unknown'],
      encodingDamage: ctx.encodingDamage,
      retentionRate: Math.max(0, Math.min(100, retentionRate)),
      confidence,
      usedHeuristicFallback: ctx.usedHeuristicFallback,
      usedSyntheticTimeline: ctx.usedSyntheticTimeline,
      issuesByCode
    }
  };
}
