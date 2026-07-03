export function formatActionSummary(summary, fallback = "操作完成") {
  if (!summary) return fallback;

  const parts = [`完成 ${summary.succeeded || 0}`];
  if (summary.skipped) parts.push(`跳过 ${summary.skipped}`);
  if (summary.failed) parts.push(`失败 ${summary.failed}`);

  const errors = Array.isArray(summary.errors) ? summary.errors.filter(Boolean).slice(0, 2) : [];
  if (errors.length > 0) {
    parts.push(errors.join("；"));
  }

  return parts.join("，");
}

