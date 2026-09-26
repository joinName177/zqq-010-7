import { ChatMessage, DataQualityIssue, ParseStatus } from '../core/models';
import { ChatParseResult, ChatParserPort } from '../ports/chat-parser.port';

const ISSUE_CAP = 50; // 错误摘要明细上限，防止极端损坏文件刷爆 UI
const EXCERPT_LEN = 60;

// WeChat: 2023-08-12 21:04:12 张三
const WECHAT_PATTERN = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(.*?)(?::|：)?$/;
// QQ: 2023-08-12 21:04:12 张三(123456)
const QQ_PATTERN = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(.*?)\(\d+\)$/;
// SMS / bracket: [2023-08-12 21:04] 张三: 内容
const BRACKET_PATTERN = /^\[?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^:：]+)[：:](.*)$/;

// 疑似损坏的消息头：行首长得像日期戳，但未命中任何已知格式
const CORRUPT_HEADER_HINT = /^[\[(]?\d{2,4}[-/.]\d/;

function excerpt(line: string): string {
  const compact = line.replace(/\s+/g, ' ').trim();
  return compact.length > EXCERPT_LEN ? compact.slice(0, EXCERPT_LEN) + '…' : compact;
}

/** 严格日期解析：非法日期返回 null，杜绝 Invalid Date 污染后续排序 */
function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** JSON 字段中的时间戳：字符串走严格解析，数字视为秒/毫秒 */
function parseJsonTimestamp(raw: unknown): Date | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'string') return parseDate(raw);
  return null;
}

interface PendingMessage {
  timestamp: Date | null;
  sender: string;
  contentLines: string[];
  headerLine: number;
  headerRaw: string;
  quality: 'parsed' | 'salvaged';
}

type IssueSeed = Omit<DataQualityIssue, 'excerpt'> & { rawLine?: string };

/**
 * 通用聊天记录解析适配器（微信 / QQ / 短信 / 逐行 JSON / 纯文本兜底）。
 *
 * 降级策略：任何单行解析失败都被隔离记录到 issues，绝不中断整份解析；
 * 无法识别为消息头的行优先折叠进上一条消息（多行正文）；
 * 游离于消息外的坏行按所在位置抢救为独立消息，时间戳以相邻有效消息回填，
 * 保证关键消息不丢失，且每条消息与每份报告都带可追溯的可靠度标识。
 */
export class UniversalChatParserAdapter implements ChatParserPort {
  async parse(rawText: string): Promise<ChatParseResult> {
    const lines = rawText.split(/\r?\n/);
    const nonEmptyCount = lines.reduce((n, l) => n + (l.trim() ? 1 : 0), 0);

    const issues: DataQualityIssue[] = [];
    const addIssue = (seed: IssueSeed) => {
      if (issues.length >= ISSUE_CAP) return;
      issues.push({
        lineNumber: seed.lineNumber,
        severity: seed.severity,
        kind: seed.kind,
        message: seed.message,
        excerpt: seed.rawLine !== undefined ? excerpt(seed.rawLine) : ''
      });
    };

    const messages: ChatMessage[] = [];
    // 文件开头、首条已知消息之前的游离行（标题/版权行等）
    const headOrphans: { line: string; lineNumber: number }[] = [];

    let pending: PendingMessage | null = null;
    let formatDetected: string | null = null;
    let sawKnownHeader = false;
    let lastValidTs: Date | null = null;
    let tailOffsetSec = 0; // 中部抢救消息相对上条有效消息的秒偏移

    const pushMessage = (m: Omit<ChatMessage, 'id'>) => {
      messages.push({ id: '', ...m });
      if (!Number.isNaN(m.timestamp.getTime())) {
        lastValidTs = m.timestamp;
        tailOffsetSec = 0;
      }
    };

    /** 无法识别的行：折叠进行中消息；否则按所处位置抢救为独立消息 */
    const salvageLine = (line: string, lineNumber: number) => {
      if (pending) {
        pending.contentLines.push(line);
        pending.quality = 'salvaged';
        return;
      }
      if (!sawKnownHeader && messages.length === 0) {
        headOrphans.push({ line, lineNumber });
        return;
      }
      // 中部游离行：锚定上一条有效时间（+60s 保持顺序），无锚点则留空待统一回填
      const ts = lastValidTs ? new Date(lastValidTs.getTime() + ++tailOffsetSec * 60_000) : new Date(NaN);
      pushMessage({
        timestamp: ts,
        sender: '未识别发言人',
        content: line,
        sentimentScore: 0,
        wordCount: line.length,
        parseQuality: 'salvaged',
        sourceLine: lineNumber
      });
    };

    const flush = (lineNumber?: number, rawLine?: string) => {
      if (!pending) return;
      const text = pending.contentLines.join('\n').trim();
      if (text) {
        pushMessage({
          timestamp: pending.timestamp ?? new Date(NaN),
          sender: pending.sender,
          content: text,
          wordCount: text.length,
          sentimentScore: 0,
          parseQuality: pending.quality,
          sourceLine: pending.headerLine
        });
      } else {
        // 有头无正文：无法保留，计入丢弃并进入错误摘要（括号即时冲刷 / 文件结束冲刷都覆盖）
        addIssue({
          lineNumber: lineNumber ?? pending.headerLine,
          severity: 'error',
          kind: 'missing-content',
          message: '消息头存在但正文为空，该条记录无法保留',
          rawLine: rawLine ?? pending.headerRaw
        });
      }
      pending = null;
    };

    lines.forEach((rawLine, idx) => {
      const lineNumber = idx + 1;
      const line = rawLine.trim();
      if (!line) return; // 空行仅作消息分隔，静默跳过

      // 乱码探针：替换字符或典型编码错位（不影响内容保留）
      if (line.includes('�') || /Ã.|Â./.test(line)) {
        addIssue({
          lineNumber,
          severity: 'warning',
          kind: 'encoding-suspect',
          message: '该行疑似存在编码损坏（如 GBK/UTF-8 误转），内容按原文保留',
          rawLine: line
        });
      }

      // 1) 短信 / 方括号时间戳格式（含显式冒号分隔的发送人）
      const bMatch = line.match(BRACKET_PATTERN);
      if (bMatch) {
        const date = parseDate(bMatch[1]);
        if (!date) {
          addIssue({
            lineNumber,
            severity: 'error',
            kind: 'invalid-date',
            message: `时间戳「${bMatch[1]}」无法解析，该行按未知内容抢救保留`,
            rawLine: line
          });
          salvageLine(line, lineNumber);
          return;
        }
        flush();
        pending = {
          timestamp: date,
          sender: bMatch[2].trim(),
          contentLines: bMatch[3].trim() ? [bMatch[3].trim()] : [],
          headerLine: lineNumber,
          headerRaw: line,
          quality: 'parsed'
        };
        formatDetected ??= '短信/方括号文本';
        sawKnownHeader = true;
        if (!bMatch[3].trim()) flush(lineNumber, line);
        return;
      }

      // 2) QQ 格式（发送人后跟 QQ 号；正文可能在下一行）
      const qMatch = line.match(QQ_PATTERN);
      if (qMatch) {
        const date = parseDate(qMatch[1]);
        if (!date) {
          addIssue({
            lineNumber,
            severity: 'error',
            kind: 'invalid-date',
            message: `时间戳「${qMatch[1]}」无法解析，该行按未知内容抢救保留`,
            rawLine: line
          });
          salvageLine(line, lineNumber);
          return;
        }
        flush();
        pending = { timestamp: date, sender: qMatch[2].trim(), contentLines: [], headerLine: lineNumber, headerRaw: line, quality: 'parsed' };
        formatDetected ??= 'QQ';
        sawKnownHeader = true;
        return;
      }

      // 3) 微信格式（发送人独占一行；正文在下一行）
      const wMatch = line.match(WECHAT_PATTERN);
      if (wMatch) {
        const date = parseDate(wMatch[1]);
        if (!date) {
          addIssue({
            lineNumber,
            severity: 'error',
            kind: 'invalid-date',
            message: `时间戳「${wMatch[1]}」无法解析，该行按未知内容抢救保留`,
            rawLine: line
          });
          salvageLine(line, lineNumber);
          return;
        }
        flush();
        pending = { timestamp: date, sender: wMatch[2].trim(), contentLines: [], headerLine: lineNumber, headerRaw: line, quality: 'parsed' };
        formatDetected ??= '微信';
        sawKnownHeader = true;
        return;
      }

      // 4) 疑似损坏消息头：像时间戳开头但三种已知格式均未命中。
      //    视为"新消息的残损头部"，先冲刷上一条消息避免污染其正文，再独立抢救。
      if (CORRUPT_HEADER_HINT.test(line)) {
        addIssue({
          lineNumber,
          severity: 'error',
          kind: 'invalid-date',
          message: '行首疑似损坏的消息头（时间戳或分隔符不完整），该行按未知内容抢救保留',
          rawLine: line
        });
        flush();
        salvageLine(line, lineNumber);
        return;
      }

      // 5) 逐行 JSON
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const rawTime = parsed.timestamp ?? parsed.time ?? parsed.date;
          const content = [parsed.content, parsed.message, parsed.text].find(
            (v): v is string => typeof v === 'string' && v.trim().length > 0
          );
          if (!content) {
            addIssue({
              lineNumber,
              severity: 'error',
              kind: 'missing-content',
              message: 'JSON 行缺少有效的 content/message/text 字段，该条记录无法保留',
              rawLine: line
            });
            return;
          }
          const timestamp = parseJsonTimestamp(rawTime);
          if (!timestamp) {
            addIssue({
              lineNumber,
              severity: 'warning',
              kind: 'invalid-date',
              message: rawTime
                ? 'JSON 时间戳无法解析，已保留消息并以相邻有效时间回填'
                : 'JSON 缺少时间戳，已保留消息并以相邻有效时间回填',
              rawLine: line
            });
          }
          const sender = [parsed.sender, parsed.user, parsed.from].find(
            (v): v is string => typeof v === 'string' && v.trim().length > 0
          );
          flush();
          pushMessage({
            timestamp: timestamp ?? new Date(NaN),
            sender: sender?.trim() ?? '未知者',
            content: content.trim(),
            sentimentScore: 0,
            wordCount: content.trim().length,
            parseQuality: timestamp ? 'parsed' : 'salvaged',
            sourceLine: lineNumber
          });
          formatDetected ??= 'JSON';
          sawKnownHeader = true;
          return;
        } catch {
          addIssue({
            lineNumber,
            severity: 'error',
            kind: 'malformed-json',
            message: '该行形似 JSON 但解析失败，已按纯文本抢救保留',
            rawLine: line
          });
          salvageLine(line, lineNumber);
          return;
        }
      }

      // 6) 普通行：已知头部之后视为多行正文折叠；游离行进入抢救路径
      if (pending) {
        pending.contentLines.push(line);
      } else if (sawKnownHeader || messages.length > 0) {
        addIssue({
          lineNumber,
          severity: 'warning',
          kind: 'unknown-format',
          message: '未命中任何已知格式的游离行，已在原位置抢救保留',
          rawLine: line
        });
        salvageLine(line, lineNumber);
      } else {
        // 文件开头的未知行：暂不逐行报错，结尾按整体情况给单条摘要
        headOrphans.push({ line, lineNumber });
      }
    });

    flush();

    // 全文件无已知格式头：纯文本兜底，逐行抢救（旧逻辑的安全保留路径，时间轴为合成估算）
    if (!sawKnownHeader && headOrphans.length > 0) {
      headOrphans.forEach(({ line, lineNumber }, idx) => {
        const parts = line.split(/[:：]/);
        const hasSender = parts.length > 1 && parts[0].trim().length > 0 && parts[0].trim().length <= 20;
        const sender = hasSender ? parts[0].trim() : idx % 2 === 0 ? '挖掘目标A' : '挖掘目标B';
        const content = hasSender ? parts.slice(1).join(':').trim() : line;
        pushMessage({
          timestamp: new Date(NaN),
          sender,
          content,
          sentimentScore: 0,
          wordCount: content.length,
          parseQuality: 'salvaged',
          sourceLine: lineNumber
        });
      });
      addIssue({
        lineNumber: 0,
        severity: 'warning',
        kind: 'unknown-format',
        message: '整份文件未命中已知导出格式，已按纯文本逐行抢救，时间轴为合成估算'
      });
      headOrphans.length = 0;
    }

    // 文件开头游离行（标题等）：前置于最早有效消息，按每分钟一条向前锚定
    if (headOrphans.length > 0) {
      const anchor = messages.find(m => !Number.isNaN(m.timestamp.getTime()));
      headOrphans
        .map(({ line, lineNumber }, idx) => {
          const ts = anchor
            ? new Date(anchor.timestamp.getTime() - (headOrphans.length - idx) * 60_000)
            : new Date(Date.now() - (messages.length + headOrphans.length - idx) * 86_400_000 * 3);
          return {
            id: '',
            timestamp: ts,
            sender: idx % 2 === 0 ? '挖掘目标A' : '挖掘目标B',
            content: line,
            sentimentScore: 0,
            wordCount: line.length,
            parseQuality: 'salvaged' as const,
            sourceLine: lineNumber
          };
        })
        .reverse()
        .forEach(m => messages.unshift(m));
      addIssue({
        lineNumber: headOrphans[0].lineNumber,
        severity: 'warning',
        kind: 'unknown-format',
        message: `文件开头 ${headOrphans.length} 行未识别为对话（可能是标题/说明），已前置于时间轴抢救保留`
      });
      headOrphans.length = 0;
    }

    // 统一回填剩余的空时间戳：向前锚定相邻有效消息，整体无有效时间则相对现在合成
    for (let i = 0; i < messages.length; i++) {
      if (!Number.isNaN(messages[i].timestamp.getTime())) continue;
      let anchorIdx = i + 1;
      while (anchorIdx < messages.length && Number.isNaN(messages[anchorIdx].timestamp.getTime())) anchorIdx++;
      if (anchorIdx < messages.length) {
        messages[i].timestamp = new Date(messages[anchorIdx].timestamp.getTime() - (anchorIdx - i) * 60_000);
      } else {
        messages[i].timestamp = new Date(Date.now() - (messages.length - i) * 86_400_000 * 3);
      }
      messages[i].parseQuality = 'salvaged';
    }
    messages.forEach((m, idx) => {
      m.id = `msg-${idx + 1}`;
    });

    const salvagedCount = messages.filter(m => m.parseQuality === 'salvaged').length;
    const droppedLineCount = issues.filter(i => i.severity === 'error' && i.kind === 'missing-content').length;
    const truncatedIssues = issues.length >= ISSUE_CAP;
    const status: ParseStatus =
      messages.length === 0 ? 'failed' : issues.length > 0 ? 'degraded' : 'complete';

    return {
      messages,
      status,
      formatDetected,
      totalLines: nonEmptyCount,
      salvagedCount,
      droppedLineCount,
      truncatedIssues,
      issues
    };
  }
}
