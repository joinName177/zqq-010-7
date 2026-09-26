export interface ChatMessage {
  id: string;
  timestamp: Date;
  sender: string;
  content: string;
  sentimentScore: number; // -1.0 to 1.0
  wordCount: number;
  /** 解析可靠度：parsed = 命中已知格式头；salvaged = 行损坏/格式未知时抢救保留 */
  parseQuality?: 'parsed' | 'salvaged';
  /** 来源文件行号（首行），便于回溯问题行 */
  sourceLine?: number;
}

/** 逐行解析状态：complete 全部识别 / degraded 部分行降级 / failed 无有效消息 */
export type ParseStatus = 'complete' | 'degraded' | 'failed';

/** 单条解析问题记录（错误摘要的最小单元） */
export interface DataQualityIssue {
  lineNumber: number; // 1 基行号，0 表示整文件级问题
  severity: 'warning' | 'error';
  kind: 'invalid-date' | 'malformed-json' | 'missing-content' | 'unknown-format' | 'encoding-suspect';
  message: string;
  excerpt: string; // 问题行截断摘要
}

/** 随分析结果一并展示的数据可靠性标识 */
export interface AnalysisDataQuality {
  source: 'preset' | 'upload';
  status: ParseStatus;
  formatDetected: string | null;
  totalLines: number; // 非空行总数
  validMessageCount: number; // 最终保留的有效消息数
  salvagedCount: number; // 抢救保留（含损坏行折叠）的消息数
  droppedLineCount: number; // 无法保留、被丢弃的行数（如空消息头）
  warningCount: number;
  errorCount: number;
  truncatedIssues: boolean; // 问题明细是否因超出上限被截断
  issues: DataQualityIssue[];
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
  /** 数据可靠性标识：报告基于何种质量的数据产出（预设标本 / 文件解析质量） */
  dataQuality: AnalysisDataQuality;
}
