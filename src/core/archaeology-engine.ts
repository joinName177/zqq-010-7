import {
  ChatMessage,
  StrataLayer,
  ArchaeologyReport,
  FossilArtifact,
  EmotionalSediment,
  RelicCategory,
  AnalysisDataQuality
} from './models';

const DICT = {
  warmth: ['喜欢', '想你', '爱你', '宝贝', '心疼', '抱抱', '开心', '可爱', '好甜', '晚安', '乖', '幸福'],
  longing: ['在哪', '什么时候见', '等你', '好想见你', '梦见你', '照片', '多久', '快回来', '挂念'],
  daily: ['吃饭', '下班', '外卖', '睡觉', '加班', '发烧', '天气', '打游戏', '视频', '起床', '路上', '哈哈哈'],
  friction: ['算了', '随便', '不想说', '每次都', '怎么又', '幼不幼稚', '好累', '解释', '吵架', '不用管我', '拉黑'],
  silence: ['嗯', '哦', '好的', '撤回了一则消息', '[语音通话]', '行吧', '没空', '。', '先忙了']
};

const GEOLOGICAL_PRESETS = [
  { epochName: '现代粉砂覆盖层（晚期渐隐）', geologicalCode: 'Q4-Modern', lithology: '松散粉细砂与风化土，压实度低，遗存稀薄', color: '#8d7b68' },
  { epochName: '次深红粘土层（沉淀冷却）', geologicalCode: 'Q3-Sediment', lithology: '致密红棕色粘土，有机质减少，间歇性水流冲刷痕迹', color: '#a75d5d' },
  { epochName: '中层含砾砂岩层（热烈胶结）', geologicalCode: 'N2-Conglomerate', lithology: '高温压实钙质胶结砂砾岩，高频对话矿物结晶显著', color: '#c38154' },
  { epochName: '下层页岩风化层（升温探索）', geologicalCode: 'E1-Shale', lithology: '薄层炭质页岩，富含大量试探性互动化石碎屑', color: '#e7a977' },
  { epochName: '远古花岗岩基岩（初见始点）', geologicalCode: 'Pt-Granite', lithology: '深层致密结晶基底，记录最初碰撞震颤与原初火花', color: '#605047' }
];

function analyzeSediment(texts: string[]): EmotionalSediment {
  let w = 0, l = 0, d = 0, f = 0, s = 0;
  for (const text of texts) {
    for (const kw of DICT.warmth) if (text.includes(kw)) w++;
    for (const kw of DICT.longing) if (text.includes(kw)) l++;
    for (const kw of DICT.daily) if (text.includes(kw)) d++;
    for (const kw of DICT.friction) if (text.includes(kw)) f++;
    for (const kw of DICT.silence) if (text.includes(kw)) s++;
  }
  const total = w + l + d + f + s || 1;
  return {
    warmth: Math.round((w / total) * 100),
    longing: Math.round((l / total) * 100),
    daily: Math.round((d / total) * 100),
    friction: Math.round((f / total) * 100),
    silence: Math.round((s / total) * 100)
  };
}

function extractTopics(texts: string[]): string[] {
  const wordsMap: Record<string, number> = {};
  const stopWords = new Set(['在', '了', '的', '我', '你', '是', '就', '都', '不', '有', '去', '好', '吗', '吧', '啊', '被', '把', '和', '这', '那']);
  
  texts.forEach(t => {
    // simple segmentation heuristic
    const cleaned = t.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(tok => tok.length >= 2 && !stopWords.has(tok));
    tokens.forEach(tok => {
      wordsMap[tok] = (wordsMap[tok] || 0) + 1;
    });
  });

  return Object.entries(wordsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => `#${w}`);
}

function findRelic(messages: ChatMessage[], depthLevel: number): FossilArtifact[] {
  const artifacts: FossilArtifact[] = [];
  if (messages.length === 0) return artifacts;

  // Search for emotional extremes
  const sortedByLength = [...messages].sort((a, b) => b.content.length - a.content.length);
  const longest = sortedByLength[0];

  if (longest && longest.content.length > 15) {
    let cat: RelicCategory = '深夜篝火';
    let note = '该层位出土长篇幅连贯文本，反映出深度情感剖白与观念共建。';
    if (longest.content.includes('对不起') || longest.content.includes('吵')) {
      cat = '交锋裂痕';
      note = '高抗拉剪切力破裂面，显微镜下可见明显的认知冲突残痕。';
    } else if (longest.content.includes('承诺') || longest.content.includes('一直') || longest.content.includes('以后')) {
      cat = '誓约泥版';
      note = '具有高硬度保存特征的未来预设性话语，质地致密。';
    } else if (depthLevel === 5) {
      cat = '初识刻石';
      note = '地层最底部的始初交互化石，保有礼貌性与试探性晶体结构。';
    }

    artifacts.push({
      id: `relic-${depthLevel}-1`,
      name: `${cat}编号#0${depthLevel}`,
      category: cat,
      depthMeters: depthLevel * 2.4,
      dateStr: longest.timestamp.toISOString().split('T')[0],
      sender: longest.sender,
      quote: longest.content.slice(0, 120) + (longest.content.length > 120 ? '...' : ''),
      archaeologicalNotes: note,
      preservationScore: Math.min(98, 60 + Math.floor(Math.random() * 35))
    });
  }

  // Also grab first message if bedrock
  if (depthLevel === 5 && messages[0]) {
    artifacts.push({
      id: `relic-origin`,
      name: '原点撞击微陨石化石',
      category: '初识刻石',
      depthMeters: 12.8,
      dateStr: messages[0].timestamp.toISOString().split('T')[0],
      sender: messages[0].sender,
      quote: messages[0].content,
      archaeologicalNotes: '双方建立双向电磁对话信道的最初始信号记录。',
      preservationScore: 99
    });
  }

  return artifacts;
}

/** 内置历史遗址标本的默认质量标识：无解析损耗，分析结论完整可信 */
export function presetDataQuality(messageCount: number): AnalysisDataQuality {
  return {
    source: 'preset',
    status: 'complete',
    formatDetected: '内置标本',
    totalLines: messageCount,
    validMessageCount: messageCount,
    salvagedCount: 0,
    droppedLineCount: 0,
    warningCount: 0,
    errorCount: 0,
    truncatedIssues: false,
    issues: []
  };
}

export function analyzeChatStrata(
  messages: ChatMessage[],
  siteName = '未知时空坐标对话遗址',
  dataQuality?: AnalysisDataQuality
): ArchaeologyReport {
  if (messages.length === 0) {
    throw new Error('聊天记录为空，无法进行地层切片勘探');
  }
  const quality = dataQuality ?? presetDataQuality(messages.length);

  // Sort chronological (oldest first)
  const sorted = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const startDate = sorted[0].timestamp;
  const endDate = sorted[sorted.length - 1].timestamp;
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));

  // Slice into 5 geological strata (from newest = Layer 1 down to oldest = Layer 5)
  const layerCount = 5;
  const chunkSize = Math.max(1, Math.ceil(sorted.length / layerCount));
  
  // Note: Geologically:
  // Top layer = newest messages (Layer 1)
  // Bedrock layer = earliest messages (Layer 5)
  const strata: StrataLayer[] = [];
  const allRelics: FossilArtifact[] = [];

  for (let i = 0; i < layerCount; i++) {
    // i = 0 is Layer 1 (newest), so we slice from end of array backwards
    const revIndex = layerCount - 1 - i; // 4, 3, 2, 1, 0
    const startIdx = revIndex * chunkSize;
    const endIdx = Math.min(sorted.length, (revIndex + 1) * chunkSize);
    const layerMsgs = sorted.slice(startIdx, endIdx);

    if (layerMsgs.length === 0) continue;

    const layerTexts = layerMsgs.map(m => m.content);
    const sediment = analyzeSediment(layerTexts);
    const topics = extractTopics(layerTexts);
    
    // Calculate temperature (0 - 100°C)
    // Warmth + longing + frequency vs silence + friction
    const warmthScore = sediment.warmth * 0.45 + sediment.longing * 0.35 + sediment.daily * 0.2;
    const coldScore = sediment.silence * 0.6 + sediment.friction * 0.4;
    const rawTemp = 20 + (warmthScore - coldScore * 0.6);
    const temperature = Math.max(4, Math.min(98, Math.round(rawTemp)));

    const preset = GEOLOGICAL_PRESETS[i] || GEOLOGICAL_PRESETS[0];
    const relics = findRelic(layerMsgs, i + 1);
    allRelics.push(...relics);

    strata.push({
      depthLevel: i + 1,
      epochName: preset.epochName,
      geologicalCode: preset.geologicalCode,
      lithology: preset.lithology,
      timeRange: {
        start: layerMsgs[0].timestamp.toISOString().split('T')[0],
        end: layerMsgs[layerMsgs.length - 1].timestamp.toISOString().split('T')[0]
      },
      messageCount: layerMsgs.length,
      temperatureCelsius: temperature,
      dominantTopics: topics.length ? topics : ['#日常碎片', '#未定义'],
      sediment,
      fossilRelics: relics,
      colorHex: preset.color,
      soilPattern: `repeating-linear-gradient(45deg, ${preset.color} 0, ${preset.color} 10px, rgba(0,0,0,0.15) 10px, rgba(0,0,0,0.15) 20px)`
    });
  }

  // Peak and cooling epoch
  const sortedByTemp = [...strata].sort((a, b) => b.temperatureCelsius - a.temperatureCelsius);
  const peakEpoch = sortedByTemp[0].epochName;
  const coolingEpoch = sortedByTemp[sortedByTemp.length - 1].epochName;

  // Carbon-14 activity (modern activity decays with time distance)
  const carbon14Activity = Math.round(Math.max(12, Math.min(99, (strata[0].temperatureCelsius * 0.7 + (100 - totalDays % 50) * 0.3))));

  const salvageRate = sorted.length > 0 ? quality.salvagedCount / sorted.length : 0;
  const qualityNote =
    quality.source === 'preset'
      ? ''
      : quality.status === 'degraded'
        ? `本次发掘含 ${quality.salvagedCount} 条抢救性标本（占 ${Math.round(salvageRate * 100)}%）、${quality.droppedLineCount} 行无法修复的残片，相关地层温度与话题结论仅供参考。`
        : '';

  return {
    siteCode: `RELIC-ARCH-${Math.floor(100000 + Math.random() * 900000)}`,
    siteName,
    excavatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    totalMessages: sorted.length,
    totalDays,
    carbon14Activity,
    strata,
    notableRelics: allRelics,
    peakEpoch,
    coolingEpoch,
    archaeologicalSummary:
      `在跨度 ${totalDays} 天的 ${sorted.length} 条对话地质标本中，发现了清晰的5层沉积构造。深层基岩呈现强烈的初生结晶热能，中层胶结致密并出土高质量情感遗存，浅层表土存在一定程度的风化沉积。` +
      qualityNote,
    curatorAssessment:
      carbon14Activity > 60
        ? '高活力地质遗址 · 存在持续地热交换与同频共生迹象'
        : '渐次固化休眠地层 · 标本完整度极高，适合永久珍藏馆陈列',
    dataQuality: quality
  };
}
