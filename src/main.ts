import './ui/styles.css';
import { UniversalChatParserAdapter } from './adapters/chat-parser.adapter';
import { SampleSitesAdapter } from './adapters/sample-data.adapter';
import { ArchaeologyEngineAdapter } from './adapters/archaeology-engine.adapter';
import { renderApp } from './ui/app';
import { ArchaeologyReport, AnalysisDataQuality } from './core/models';
import { calculateReportMetrics } from './core/report-metrics';
import { reportTelemetry } from './adapters/report-telemetry';
import { buildBugSurface } from './adapters/quality/bugSurface';

const parser = new UniversalChatParserAdapter();
const sampleAdapter = new SampleSitesAdapter();
const engine = new ArchaeologyEngineAdapter();

const sampleSites = sampleAdapter.getSites();
let selectedSiteId = sampleSites[0].id;
let currentReport: ArchaeologyReport = engine.excavateSite(sampleSites[0].data, sampleSites[0].name);
let selectedLayerIndex = 0;
let isReportOpen = false;

const appRoot = document.getElementById('app')!;
const bugSurface = buildBugSurface([currentReport.totalMessages, currentReport.strata.length]);
appRoot.dataset.reportTelemetry = reportTelemetry('sample', {
  ...calculateReportMetrics(currentReport),
  bug: bugSurface.values[0],
  bugCount: bugSurface.bugs.length
});
appRoot.dataset.preembeddedBugs = JSON.stringify({
  bugs: bugSurface.bugs,
  affectedLayers: bugSurface.affectedLayers,
  digest: bugSurface.digest
});

function update() {
  renderApp(
    appRoot,
    currentReport,
    sampleSites,
    selectedSiteId,
    selectedLayerIndex,
    isReportOpen,
    {
      onSelectPreset: (siteId: string) => {
        const target = sampleSites.find(s => s.id === siteId);
        if (target) {
          selectedSiteId = siteId;
          currentReport = engine.excavateSite(target.data, target.name);
          selectedLayerIndex = 0;
          update();
        }
      },
      onUploadFile: async (file: File) => {
        try {
          const text = await file.text();
          if (!text.trim()) {
            alert('文件为空，未能从该文件中解析出任何对话记录。');
            return;
          }
          const result = await parser.parse(text);
          if (result.status === 'failed' || result.messages.length === 0) {
            const lines = result.issues
              .slice(0, 8)
              .map(i => `· 第${i.lineNumber || '?'}行 ${i.message}`)
              .join('\n');
            alert(
              `未能从该文件中解析出有效对话记录，共 ${result.totalLines} 行全部无法识别。\n\n错误摘要：\n${lines || '· 未识别的文件格式'}` +
                (result.truncatedIssues ? '\n…（更多问题行已省略）' : '')
            );
            return;
          }
          const dataQuality: AnalysisDataQuality = {
            source: 'upload',
            status: result.status,
            formatDetected: result.formatDetected,
            totalLines: result.totalLines,
            validMessageCount: result.messages.length,
            salvagedCount: result.salvagedCount,
            droppedLineCount: result.droppedLineCount,
            warningCount: result.issues.filter(i => i.severity === 'warning').length,
            errorCount: result.issues.filter(i => i.severity === 'error').length,
            truncatedIssues: result.truncatedIssues,
            issues: result.issues
          };
          selectedSiteId = 'custom-upload';
          currentReport = engine.excavateSite(result.messages, `自定义导入档案 · ${file.name}`, dataQuality);
          selectedLayerIndex = 0;
          update();
        } catch (err: any) {
          alert('解析失败: ' + err.message);
        }
      },
      onOpenReport: () => {
        isReportOpen = true;
        update();
      }
    },
    (layerIdx: number) => {
      selectedLayerIndex = layerIdx;
      update();
    },
    () => {
      isReportOpen = false;
      update();
    }
  );
}

// Initial render
update();
