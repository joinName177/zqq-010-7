import { ChatMessage, ArchaeologyReport } from '../core/models';
import { ParseResult } from '../core/parse-quality';

export interface ArchaeologyPort {
  /** parseResult 缺省时（内置标本），报告标记为高置信度 */
  excavateSite(messages: ChatMessage[], siteName?: string, parseResult?: ParseResult): ArchaeologyReport;
}
