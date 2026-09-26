import { ParseResult, ParseSummary } from '../core/parse-quality';

export interface ChatParserPort {
  /**
   * 逐行解析聊天记录：
   * - 单行失败不影响其他行（逐行降级）；
   * - 所有问题进入 issues 与 summary（错误摘要）；
   * - 可恢复的内容以带质量标记的消息保留（有效消息保留）。
   */
  parse(rawText: string): Promise<ParseResult>;
}

export type { ParseResult, ParseSummary };
