import type { AnalysisQuality, MessageQuality } from './parse-quality';

export interface ChatMessage {
  id: string;
  timestamp: Date;
  sender: string;
  content: string;
  sentimentScore: number; // -1.0 to 1.0
  wordCount: number;
  /** 逐行解析的来源与质量标记；缺省视为高置信度结构化消息（如内置标本） */
  quality?: MessageQuality;
}

export type RelicCategory = '初识刻石' | '誓约泥版' | '交锋裂痕' | '深夜篝火' | '寂静化石';

export interface FossilArtifact {
  id: string;
  name: string;
  category: RelicCategory;
  depthMeters: number;
  dateStr: string;
  sender: string;
  quote: string;
  archaeologicalNotes: string;
  preservationScore: number; // 0 - 100
}

export interface EmotionalSediment {
  warmth: number;   // 依恋温存 %
  longing: number;  // 牵挂思念 %
  daily: number;    // 生活琐碎 %
  friction: number; // 情绪摩擦 %
  silence: number;  // 沉默冷却 %
}

export interface StrataLayer {
  depthLevel: number; // 1 to 5 (1 = 最浅层，5 = 最深古基岩)
  epochName: string;
  geologicalCode: string;
  lithology: string; // 岩性描述 (如：风化黄土带, 细砂沉积带, 坚硬花岗基岩)
  timeRange: { start: string; end: string };
  messageCount: number;
  /** 该层中经降级恢复保留的消息数（用于层位结果标识） */
  recoveredMessageCount: number;
  /** 该层中孤立语料抢救的消息数（recoveredMessageCount 的子集） */
  salvagedMessageCount: number;
  temperatureCelsius: number; // 关系温度 (0 - 100)
  dominantTopics: string[];
  sediment: EmotionalSediment;
  fossilRelics: FossilArtifact[];
  colorHex: string;
  soilPattern: string;
}

export interface ArchaeologyReport {
  siteCode: string;
  siteName: string;
  excavatedAt: string;
  totalMessages: number;
  totalDays: number;
  carbon14Activity: number; // 碳14残留活性 %
  strata: StrataLayer[];
  notableRelics: FossilArtifact[];
  peakEpoch: string;
  coolingEpoch: string;
  archaeologicalSummary: string;
  curatorAssessment: string;
  /** 数据质量与分析结果标识；内置标本缺省为高置信度 */
  analysisQuality?: AnalysisQuality;
}
