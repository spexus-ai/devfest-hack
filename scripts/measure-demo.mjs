const argumentsByName = Object.fromEntries(
  process.argv.slice(2).map((argument) => argument.match(/^--([a-z-]+)=(.+)$/)?.slice(1) ?? []),
);
const timeKeys = ['manual-employee', 'manual-reviewer', 'autopilot-employee', 'autopilot-reviewer'];
if (timeKeys.some((key) => argumentsByName[key] === undefined || !Number.isFinite(Number(argumentsByName[key]))
    || Number(argumentsByName[key]) < 0)) {
  console.error('Укажите фактические активные минуты: --manual-employee=… --manual-reviewer=… '
    + '--autopilot-employee=… --autopilot-reviewer=…');
  process.exitCode = 1;
} else {
  const values = timeKeys.map((key) => Number(argumentsByName[key]));
  const [manualEmployee, manualReviewer, assistedEmployee, assistedReviewer] = values;
  console.log(JSON.stringify({
    manualMinutes: { employee: manualEmployee, reviewer: manualReviewer, total: manualEmployee + manualReviewer },
    autopilotMinutes: { employee: assistedEmployee, reviewer: assistedReviewer, total: assistedEmployee + assistedReviewer },
    savedMinutesPerRequest: Number((manualEmployee + manualReviewer - assistedEmployee - assistedReviewer).toFixed(2)),
    autopilotElapsedMinutes: Number(argumentsByName['elapsed'] ?? 0) || null,
    manualCorrections: argumentsByName['corrections'] === undefined ? null : Number(argumentsByName['corrections']),
    apiCostUsd: argumentsByName['api-cost'] === undefined ? null : Number(argumentsByName['api-cost']),
    policyDeadlineDays: 60,
  }, null, 2));
}
