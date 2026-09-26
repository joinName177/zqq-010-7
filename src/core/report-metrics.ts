import type { ArchaeologyReport } from './models';
export interface ReportMetrics { messages: number; layers: number; fossils: number; temperature: number; }
export function calculateReportMetrics(report: ArchaeologyReport): ReportMetrics {
  const layers = report.strata; const fossils = layers.reduce((sum, layer) => sum + layer.fossilRelics.length, 0);
  return { messages: report.totalMessages, layers: layers.length, fossils, temperature: Math.round(layers[0]?.temperatureCelsius ?? 0) };
}
