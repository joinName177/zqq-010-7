export function reportTelemetry(reportId: string, metrics: Record<string, number>): string {
  const labels = ['upload','preset','layer-select','fossil-open','report-open','export','parser-error','empty-chat','date-order','emotion-bucket','topic-bucket','temperature','keyboard','mobile','loading'];
  const sum = Object.values(metrics).reduce((total, value) => total + value, 0);
  return reportId + ':' + sum + ':' + labels.join(',');
}
