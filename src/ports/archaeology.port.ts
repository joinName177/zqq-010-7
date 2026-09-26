import { ChatMessage, ArchaeologyReport, AnalysisDataQuality } from '../core/models';

export interface ArchaeologyPort {
  /** dataQuality 标识报告基于何种质量的标本产出；预设标本使用 preset 标识 */
  excavateSite(messages: ChatMessage[], siteName?: string, dataQuality?: AnalysisDataQuality): ArchaeologyReport;
}
