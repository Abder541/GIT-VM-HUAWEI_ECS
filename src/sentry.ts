// Minimal, dependency-free Sentry error reporting. No-op unless SENTRY_DSN is set.
// DSN format: https://<publicKey>@<host>/<projectId>

export function reportError(
  dsn: string | undefined,
  err: unknown,
  ctx: { waitUntil(promise: Promise<unknown>): void },
  extra?: Record<string, unknown>
): void {
  if (!dsn) return;
  const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!m) return;
  const [, key, host, project] = m;
  const url = `https://${host}/api/${project}/store/?sentry_key=${key}&sentry_version=7`;
  const e = err instanceof Error ? err : new Error(String(err));
  const body = JSON.stringify({
    platform: 'javascript',
    level: 'error',
    timestamp: Date.now() / 1000,
    exception: { values: [{ type: e.name, value: e.message }] },
    extra,
  });
  ctx.waitUntil(
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then(() => undefined)
      .catch(() => undefined)
  );
}
