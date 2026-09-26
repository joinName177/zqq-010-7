import { ArchaeologyReport, StrataLayer } from '../core/models';
import { issueLabel } from '../core/parse-quality';
import { SampleSite } from '../adapters/sample-data.adapter';

export interface UIEventHandlers {
  onSelectPreset: (siteId: string) => void;
  onUploadFile: (file: File) => void;
  onOpenReport: () => void;
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

  // 数据质量横幅：仅在发生降级时出现，明确区分“可信结论”与“抢救性结论”
  const q = report.analysisQuality;
  const qualityBanner = q && q.flag !== 'high-confidence'
    ? `
      <section class="quality-banner quality-${q.flag}">
        <div class="quality-head">
          <span class="quality-icon">${q.flag === 'salvage-only' ? '⚠️' : '🛠️'}</span>
          <div class="quality-text">
            <strong>${escapeHtml(q.label)}</strong>
            <p>${escapeHtml(q.notice)}</p>
          </div>
          <details class="quality-details">
            <summary>查看错误摘要（${q.summary.issueCount} 项）</summary>
            <div class="quality-table-wrap">
              <table class="quality-table">
                <thead>
                  <tr><th>行号</th><th>类型</th><th>级别</th><th>说明</th><th>原始片段</th></tr>
                </thead>
                <tbody>
                  ${q.issues
                    .map(
                      iss => `
                    <tr>
                      <td>${iss.line === 0 ? '全局' : iss.line}</td>
                      <td>${escapeHtml(issueLabel(iss.code))}</td>
                      <td><span class="sev sev-${iss.severity}">${iss.severity === 'error' ? '错误' : '警告'}</span></td>
                      <td>${escapeHtml(iss.message)}</td>
                      <td class="raw-preview">${iss.rawPreview ? escapeHtml(iss.rawPreview) : '—'}</td>
                    </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
              ${q.summary.issueCount > q.issues.length ? `<p class="quality-more">仅展示前 ${q.issues.length} 条明细，总计 ${q.summary.issueCount} 项（计数完整）。</p>` : ''}
            </div>
          </details>
        </div>
        <div class="quality-chips">
          <span class="q-chip">识别格式：${q.summary.detectedFormats.map(escapeHtml).join(' / ')}</span>
          <span class="q-chip">结构化 ${q.summary.structuredMessages}</span>
          <span class="q-chip q-chip-recovered">降级恢复 ${q.summary.recoveredMessages}</span>
          <span class="q-chip q-chip-salvaged">抢救语料 ${q.summary.salvagedMessages}</span>
          <span class="q-chip">丢弃 ${q.summary.droppedLines}</span>
          <span class="q-chip">保留率 ${q.summary.retentionRate}%</span>
        </div>
      </section>`
    : '';

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

      ${qualityBanner}

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
                ${
                  layer.recoveredMessageCount > 0
                    ? `<div class="layer-recovered" title="该层含降级恢复的消息">🛠️ 恢复 ${layer.recoveredMessageCount}${layer.salvagedMessageCount > 0 ? ` · 抢救 ${layer.salvagedMessageCount}` : ''}</div>`
                    : ''
                }
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
            ${
              currentLayer.recoveredMessageCount > 0
                ? `<div class="detail-provenance">🛠️ 本层 ${currentLayer.recoveredMessageCount}/${currentLayer.messageCount} 条来自降级恢复${currentLayer.salvagedMessageCount > 0 ? `（其中 ${currentLayer.salvagedMessageCount} 条为未知格式抢救语料）` : ''}，温度与话题结论已据此标记。</div>`
                : ''
            }
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
              q && q.flag !== 'high-confidence'
                ? `
            <div class="report-section report-quality quality-${q.flag}">
              <h4>标本数据质量与结论标识：</h4>
              <p><strong>${escapeHtml(q.label)}</strong></p>
              <p>${escapeHtml(q.notice)}</p>
              <table class="quality-table quality-table-compact">
                <tbody>
                  <tr><td>识别格式</td><td>${q.summary.detectedFormats.map(escapeHtml).join(' / ')}</td></tr>
                  <tr><td>结构化消息</td><td>${q.summary.structuredMessages} 条</td></tr>
                  <tr><td>降级恢复保留</td><td>${q.summary.recoveredMessages} 条（其中抢救语料 ${q.summary.salvagedMessages} 条）</td></tr>
                  <tr><td>无法恢复已丢弃</td><td>${q.summary.droppedLines} 行</td></tr>
                  <tr><td>错误 / 警告</td><td>${q.summary.errorCount} / ${q.summary.warningCount}</td></tr>
                  <tr><td>有效消息保留率</td><td>${q.summary.retentionRate}%</td></tr>
                </tbody>
              </table>
            </div>`
                : ''
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
