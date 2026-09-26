import { ArchaeologyReport, StrataLayer, DataQualityIssue } from '../core/models';
import { SampleSite } from '../adapters/sample-data.adapter';

const ISSUE_KIND_LABEL: Record<DataQualityIssue['kind'], string> = {
  'invalid-date': '时间戳损坏',
  'malformed-json': 'JSON 损坏',
  'missing-content': '空消息丢弃',
  'unknown-format': '未知格式',
  'encoding-suspect': '编码疑似损坏'
};

export interface UIEventHandlers {
  onSelectPreset: (siteId: string) => void;
  onUploadFile: (file: File) => void;
  onOpenReport: () => void;
}

/** 报告级数据可靠性横幅：让使用者一眼知道结论基于何种质量的标本 */
function renderQualityBanner(report: ArchaeologyReport): string {
  const q = report.dataQuality;
  if (q.source === 'preset') {
    return `<div class="quality-banner qb-preset">🏺 <span>内置历史遗址标本 · 格式完整，分析结论为标准鉴定结果</span></div>`;
  }
  if (q.status === 'complete') {
    return `<div class="quality-banner qb-complete">✅ <span>解析完整：识别为「${q.formatDetected ?? '未知'}」格式，${q.validMessageCount} 条消息全部成功入藏，无损耗</span></div>`;
  }
  if (q.status === 'degraded') {
    return `
      <div class="quality-banner qb-degraded">
        <span>⚠️ 标本降级鉴定：识别为「${q.formatDetected ?? '纯文本兜底'}」格式 · 共 ${q.totalLines} 行，有效保留 ${q.validMessageCount} 条（含抢救 ${q.salvagedCount} 条），丢弃 ${q.droppedLineCount} 行 · 错误 ${q.errorCount} / 警告 ${q.warningCount}</span>
        <details class="qb-details">
          <summary>查看错误摘要（${q.issues.length}${q.truncatedIssues ? '+' : ''} 条）</summary>
          <ul class="qb-issue-list">
            ${q.issues
              .map(
                i => `
              <li class="qb-issue qb-${i.severity}">
                <span class="qb-line">第${i.lineNumber || '文件'}行</span>
                <span class="qb-tag">${ISSUE_KIND_LABEL[i.kind]}</span>
                <span class="qb-msg">${i.message}</span>
                ${i.excerpt ? `<code class="qb-excerpt">${i.excerpt}</code>` : ''}
              </li>`
              )
              .join('')}
            ${q.truncatedIssues ? '<li class="qb-trunc">问题行过多，仅展示前 50 条</li>' : ''}
          </ul>
        </details>
      </div>`;
  }
  return `<div class="quality-banner qb-failed">❌ <span>未能解析出任何有效消息</span></div>`;
}

export function renderApp(
  container: HTMLElement,
  report: ArchaeologyReport,
  sampleSites: SampleSite[],
  selectedSiteId: string,
  selectedLayerIndex: number,
  isReportOpen: boolean,
  handlers: UIEventHandlers,
  onSelectLayer: (idx: number) => void,
  onCloseReport: () => void
) {
  const currentLayer = report.strata[selectedLayerIndex] || report.strata[0];

  const escapeHtml = (str: string) =>
    str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));

  container.innerHTML = `
    <div class="archaeo-app">
      <header class="site-header">
        <div class="brand">
          <div class="brand-icon">⛏️</div>
          <div>
            <h1>对话地层学 · 关系考古勘探系统</h1>
            <p>RELATIONSHIP STRATIGRAPHY &amp; EXCAVATION REPORT · v1.0.0</p>
          </div>
        </div>
        <div class="header-status">
          <span>● 发掘就绪 | 标本勘测点：${escapeHtml(report.siteCode)}</span>
        </div>
      </header>

      <section class="control-hub">
        <div class="preset-sites">
          <div class="preset-title">
            <span>🏺 历史遗址标本库 (点击切换发掘地)：</span>
          </div>
          <div class="preset-btns">
            ${sampleSites
              .map(
                s => `
              <button class="btn-preset ${s.id === selectedSiteId ? 'active' : ''}" data-site="${s.id}">
                <strong>${escapeHtml(s.name)}</strong>
                <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(s.eraSpan)}</div>
              </button>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="upload-section">
          <div class="drop-area" id="dropArea">
            <input type="file" id="chatFileInput" class="file-input" accept=".txt,.json,.csv" />
            <p>📄 拖拽或点击导入本地聊天记录文件 (支持微信/QQ/短信文本导出格式)</p>
            <span style="font-size:12px;color:var(--text-muted);">纯前端本地地质切片计算，无任何网络传输</span>
          </div>
          <button class="btn-report" id="btnOpenReport">
            📜 生成关系考古报告
          </button>
        </div>
      </section>

      ${renderQualityBanner(report)}

      <main class="strata-layout">
        <!-- Left: Stratigraphic Column -->
        <section class="core-column-wrap">
          <div class="column-title">
            <h3>🏛️ 对话地层岩芯柱 (自浅入深)</h3>
            <span class="depth-indicator">总发掘深度: ${report.strata.length * 2.5}m</span>
          </div>
          <div class="strata-stack">
            ${report.strata
              .map(
                (layer, idx) => `
              <div class="strata-card ${idx === selectedLayerIndex ? 'selected' : ''}" 
                   data-layer="${idx}" 
                   style="--layer-color: ${layer.colorHex}">
                <div class="strata-card-header">
                  <span class="layer-tag">Layer 0${layer.depthLevel} · ${layer.geologicalCode}</span>
                  <span class="layer-depth">深度 -${(layer.depthLevel * 2.4).toFixed(1)}m</span>
                </div>
                <div class="layer-name">${escapeHtml(layer.epochName)}</div>
                <div class="layer-meta">
                  <span>${layer.timeRange.start} ~ ${layer.timeRange.end}</span>
                  <span class="temp-badge">${layer.temperatureCelsius}°C</span>
                </div>
              </div>
            `
              )
              .join('')}
          </div>
        </section>

        <!-- Right: Layer Inspection Details -->
        <section class="detail-panel">
          <div class="detail-header">
            <div class="detail-epoch">
              Layer 0${currentLayer.depthLevel}：${escapeHtml(currentLayer.epochName)}
            </div>
            <div class="detail-lithology">
              <strong>岩相剖面特征：</strong>${escapeHtml(currentLayer.lithology)}
            </div>
          </div>

          <!-- Temperature -->
          <div class="temp-gauge-box">
            <div class="gauge-title">
              <span>关系地温指数：${currentLayer.temperatureCelsius}°C</span>
              <span>记录密度：${currentLayer.messageCount} 条对话遗存</span>
            </div>
            <div class="gauge-bar-bg">
              <div class="gauge-bar-fill" style="width: ${currentLayer.temperatureCelsius}%"></div>
            </div>
          </div>

          <!-- Emotional Sediment -->
          <div class="sediment-box">
            <div style="font-size:13px;color:var(--earth-accent);font-weight:600;">
              🧪 情感词汇沉积物化验分析 (Sediment Spectrum)：
            </div>
            <div class="sediment-bars">
              <div class="sediment-item">
                <span>依恋温存</span>
                <div class="sediment-progress"><div class="sediment-fill" style="width:${currentLayer.sediment.warmth}%;background:#e76f51;"></div></div>
                <span>${currentLayer.sediment.warmth}%</span>
              </div>
              <div class="sediment-item">
                <span>牵挂思念</span>
                <div class="sediment-progress"><div class="sediment-fill" style="width:${currentLayer.sediment.longing}%;background:#f4a261;"></div></div>
                <span>${currentLayer.sediment.longing}%</span>
              </div>
              <div class="sediment-item">
                <span>生活琐碎</span>
                <div class="sediment-progress"><div class="sediment-fill" style="width:${currentLayer.sediment.daily}%;background:#2a9d8f;"></div></div>
                <span>${currentLayer.sediment.daily}%</span>
              </div>
              <div class="sediment-item">
                <span>情绪摩擦</span>
                <div class="sediment-progress"><div class="sediment-fill" style="width:${currentLayer.sediment.friction}%;background:#9d0208;"></div></div>
                <span>${currentLayer.sediment.friction}%</span>
              </div>
              <div class="sediment-item">
                <span>沉默冷却</span>
                <div class="sediment-progress"><div class="sediment-fill" style="width:${currentLayer.sediment.silence}%;background:#6c757d;"></div></div>
                <span>${currentLayer.sediment.silence}%</span>
              </div>
            </div>
          </div>

          <!-- Dominant Topics -->
          <div style="background:var(--panel-card);padding:16px;border-radius:8px;border:1px solid var(--border-color);">
            <div style="font-size:13px;color:var(--earth-accent);margin-bottom:6px;">
              🏷️ 该层出土核心话题印记：
            </div>
            <div class="topics-cloud">
              ${currentLayer.dominantTopics.map(t => `<span class="topic-chip">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>

          <!-- Fossils in this layer -->
          <div class="fossils-section">
            <h4>⛏️ 该层位代表性对话化石 (Unearthed Artifacts)</h4>
            <div class="fossil-cards">
              ${
                currentLayer.fossilRelics.length > 0
                  ? currentLayer.fossilRelics
                      .map(
                        f => `
                    <div class="fossil-item">
                      <div class="fossil-top">
                        <span class="fossil-badge">${escapeHtml(f.category)}</span>
                        <span style="font-family:var(--font-mono);color:var(--text-muted);">${f.dateStr} · 发掘深度 -${f.depthMeters.toFixed(1)}m</span>
                      </div>
                      <div class="fossil-quote">“${escapeHtml(f.quote)}”</div>
                      <div class="fossil-notes">🔬 考古学鉴定：${escapeHtml(f.archaeologicalNotes)} (保存完好度: ${f.preservationScore}%)</div>
                    </div>
                  `
                      )
                      .join('')
                  : `<div style="color:var(--text-muted);font-size:13px;">该地层未发现突异晶体化石，呈现均匀日常沉积。</div>`
              }
            </div>
          </div>
        </section>
      </main>

      <!-- Modal: Report -->
      ${
        isReportOpen
          ? `
        <div class="modal-overlay" id="reportOverlay">
          <div class="modal-content">
            <div class="report-seal">国家地层考古认证</div>
            <div class="report-header">
              <h2>《${escapeHtml(report.siteName)}》关系考古发掘总报告</h2>
              <div class="report-sub">
                ARCHAEOLOGICAL FIELD REPORT · 编号 ${escapeHtml(report.siteCode)} · 发掘时间：${report.excavatedAt}
              </div>
            </div>

            <div class="report-grid">
              <div class="report-stat-card">
                <div class="val">${report.totalDays} 天</div>
                <div class="lbl">对话地质沉淀跨度</div>
              </div>
              <div class="report-stat-card">
                <div class="val">${report.totalMessages} 条</div>
                <div class="lbl">出土总话语标本</div>
              </div>
              <div class="report-stat-card">
                <div class="val">${report.carbon14Activity}%</div>
                <div class="lbl">碳14现代残余活性</div>
              </div>
            </div>

            <div class="report-section">
              <h4>地层温差纪年：</h4>
              <p>最高温纪元：<strong>${escapeHtml(report.peakEpoch)}</strong></p>
              <p>渐冷纪元：<strong>${escapeHtml(report.coolingEpoch)}</strong></p>
            </div>

            <div class="report-section">
              <h4>地质剖面综述：</h4>
              <p>${escapeHtml(report.archaeologicalSummary)}</p>
            </div>

            <div class="report-section">
              <h4>馆藏专家终审评定：</h4>
              <p>“${escapeHtml(report.curatorAssessment)}”</p>
            </div>

            ${
              report.dataQuality.source === 'upload'
                ? `
            <div class="report-section report-quality ${
              report.dataQuality.status === 'degraded' ? 'rq-degraded' : 'rq-complete'
            }">
              <h4>🔖 标本完整性鉴定（分析结果标识）：</h4>
              <p>
                数据来源：用户导入文件 · 识别格式：<strong>${escapeHtml(report.dataQuality.formatDetected ?? '纯文本兜底')}</strong>
                · 鉴定结论：<strong>${report.dataQuality.status === 'complete' ? '完整标本' : '降级标本'}</strong>
              </p>
              <p>
                扫描 ${report.dataQuality.totalLines} 行 → 有效消息 ${report.dataQuality.validMessageCount} 条
                （其中抢救恢复 ${report.dataQuality.salvagedCount} 条）· 无法修复残片 ${report.dataQuality.droppedLineCount} 行
                · 错误 ${report.dataQuality.errorCount} 项 / 警告 ${report.dataQuality.warningCount} 项
              </p>
              ${
                report.dataQuality.issues.length > 0
                  ? `
                <details>
                  <summary>问题行清单（${report.dataQuality.issues.length}${report.dataQuality.truncatedIssues ? '+' : ''}）</summary>
                  <ul class="qb-issue-list report-issue-list">
                    ${report.dataQuality.issues
                      .map(
                        i => `
                      <li class="qb-issue qb-${i.severity}">
                        <span class="qb-line">第${i.lineNumber || '文件'}行</span>
                        <span class="qb-tag">${ISSUE_KIND_LABEL[i.kind]}</span>
                        <span class="qb-msg">${escapeHtml(i.message)}</span>
                        ${i.excerpt ? `<code class="qb-excerpt">${escapeHtml(i.excerpt)}</code>` : ''}
                      </li>`
                      )
                      .join('')}
                    ${report.dataQuality.truncatedIssues ? '<li class="qb-trunc">问题行过多，仅展示前 50 条</li>' : ''}
                  </ul>
                </details>`
                  : '<p>全部行均通过格式校验，本报告结论建立在完整无损的原始记录之上。</p>'
              }
            </div>`
                : `
            <div class="report-section report-quality rq-preset">
              <h4>🔖 标本完整性鉴定（分析结果标识）：</h4>
              <p>数据来源：内置历史遗址标本库 · ${report.totalMessages} 条标本均为结构化完整数据，鉴定结论为标准鉴定结果。</p>
            </div>`
            }

            <div class="report-actions">
              <button class="btn-secondary" id="btnCloseReport">关闭报告</button>
              <button class="btn-report" onclick="window.print()">🖨️ 打印 / 保存标本档案</button>
            </div>
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;

  // Attach event listeners
  container.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const siteId = btn.getAttribute('data-site');
      if (siteId) handlers.onSelectPreset(siteId);
    });
  });

  const dropArea = container.querySelector('#dropArea');
  const fileInput = container.querySelector('#chatFileInput') as HTMLInputElement;

  if (dropArea && fileInput) {
    dropArea.addEventListener('click', () => fileInput.click());
    dropArea.addEventListener('dragover', e => {
      e.preventDefault();
      dropArea.classList.add('hover');
    });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('hover'));
    dropArea.addEventListener('drop', e => {
      e.preventDefault();
      dropArea.classList.remove('hover');
      const files = (e as DragEvent).dataTransfer?.files;
      if (files && files.length > 0) {
        handlers.onUploadFile(files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handlers.onUploadFile(fileInput.files[0]);
      }
    });
  }

  container.querySelector('#btnOpenReport')?.addEventListener('click', () => {
    handlers.onOpenReport();
  });

  container.querySelectorAll('.strata-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.getAttribute('data-layer') || '0', 10);
      onSelectLayer(idx);
    });
  });

  container.querySelector('#btnCloseReport')?.addEventListener('click', () => {
    onCloseReport();
  });

  container.querySelector('#reportOverlay')?.addEventListener('click', e => {
    if (e.target === container.querySelector('#reportOverlay')) {
      onCloseReport();
    }
  });
}
