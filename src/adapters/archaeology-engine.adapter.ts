import { ChatMessage, ArchaeologyReport } from '../core/models';
import { analyzeChatStrata } from '../core/archaeology-engine';
import { ArchaeologyPort } from '../ports/archaeology.port';

export class ArchaeologyEngineAdapter implements ArchaeologyPort {
  excavateSite(messages: ChatMessage[], siteName?: string): ArchaeologyReport {
    return analyzeChatStrata(messages, siteName);
  }
}
