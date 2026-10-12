/** Process CPU is indicative only: concurrent Fluid requests share this counter. */
export function startTaskMetrics(task: string) {
  const startedAt = performance.now();
  const startCpu = process.cpuUsage();
  return (counts: Record<string, number | boolean | string> = {}) => {
    const cpu = process.cpuUsage(startCpu);
    const metrics = {
      task,
      wallMs: Math.round(performance.now() - startedAt),
      processCpuMs: Math.round((cpu.user + cpu.system) / 1000),
      cpuScope: "process-shared-not-billing",
      ...counts,
    };
    console.log(`[task] ${JSON.stringify(metrics)}`);
    return metrics;
  };
}
