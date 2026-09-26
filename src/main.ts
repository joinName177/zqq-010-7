import './ui/styles.css';
import { UniversalChatParserAdapter } from './adapters/chat-parser.adapter';
import { SampleSitesAdapter } from './adapters/sample-data.adapter';
import { ArchaeologyEngineAdapter } from './adapters/archaeology-engine.adapter';
import { renderApp } from './ui/app';
import { ArchaeologyReport } from './core/models';
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
          const msgs = await parser.parse(text);
          if (msgs.length === 0) {
            alert('未能从该文件中解析出有效对话记录，请检查文件格式。');
            return;
          }
          selectedSiteId = 'custom-upload';
          currentReport = engine.excavateSite(msgs, `自定义导入档案 · ${file.name}`);
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
