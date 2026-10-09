/** Alerts describe observed status, never words in explanatory prose. */
const alertStatuses = new Set([
  "failed", "failure", "stopped", "inactive", "dead", "down", "offline",
  "error", "unreachable", "timeout", "refused", "missing", "degraded",
]);
export function nodeIsAlerting(node: { status?: string; detail?: string }): boolean {
  return alertStatuses.has((node.status || "").trim().toLowerCase());
}
