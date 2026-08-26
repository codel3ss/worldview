const UA = 'worldview/0.1 (+https://github.com/codel3ss/worldview)';

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * Every outbound call from the proxy goes through here: one place for the
 * user agent upstreams ask for, one place for timeouts, one place that never
 * leaks an API key into an error message.
 */
export async function upstream(url, { timeoutMs = 20_000, headers = {}, redactPattern, ...rest } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: '*/*', ...headers },
    });
    if (!res.ok) {
      const safe = redactPattern ? String(url).replace(redactPattern, 'key=***') : new URL(url).host;
      throw new UpstreamError(`${res.status} ${res.statusText} from ${safe}`, res.status === 429 ? 429 : 502);
    }
    return res;
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err.name === 'AbortError') throw new UpstreamError('upstream timed out', 504);
    throw new UpstreamError(err.message || 'upstream unreachable', 502);
  } finally {
    clearTimeout(timer);
  }
}
