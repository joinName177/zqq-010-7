import { ChatMessage, ParseStatus, DataQualityIssue } from '../core/models';

/**
 * 逐行降级解析结果：
 * 解析器不因单条坏行抛出整份失败，而是返回保留下来的有效消息 + 错误摘要。
 */
export interface ChatParseResult {
  messages: ChatMessage[];
  status: ParseStatus;
  formatDetected: string | null;
  totalLines: number;
  salvagedCount: number;
  droppedLineCount: number;
  truncatedIssues: boolean;
  issues: DataQualityIssue[];
}

export interface ChatParserPort {
  /** 解析成功以 Promise.resolve 返回（status 可能为 degraded）；仅整文件不可读时 reject */
  parse(rawText: string): Promise<ChatParseResult>;
}
