import { ChatMessage, ArchaeologyReport } from '../core/models';

export interface ArchaeologyPort {
  excavateSite(messages: ChatMessage[], siteName?: string): ArchaeologyReport;
}
