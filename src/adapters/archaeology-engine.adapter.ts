import { ChatMessage, ArchaeologyReport } from '../core/models';
import { analyzeChatStrata } from '../core/archaeology-engine';
import { ParseResult } from '../core/parse-quality';
import { ArchaeologyPort } from '../ports/archaeology.port';

export class ArchaeologyEngineAdapter implements ArchaeologyPort {
  excavateSite(messages: ChatMessage[], siteName?: string, parseResult?: ParseResult): ArchaeologyReport {
    return analyzeChatStrata(messages, siteName, parseResult);
  }
}
