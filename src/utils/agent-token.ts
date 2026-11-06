// Mints short-lived Bearer tokens for the agent from the program's identity
// site, which authenticates the browser with its own session cookie. Ported
// from chatbot-fullscreen-client's lib/agent-token.ts; the rules follow the
// agent-token contract's browser consumer rules. The token is opaque here:
// nothing reads its claims.

// Mint again before a request when less than this remains. The agent refuses
// tokens with less than its turn timeout plus 30 seconds (150s) left.
export const REFRESH_MARGIN_MS = 180_000;
// After a failed mint, requests reuse the failure instead of each asking
// again; the contract allows no automatic retry.
export const FAILED_MINT_FLOOR_MS = 30_000;
// A signed-out page re-mints on window focus at most this often, so tab
// switching doesn't turn into a stream of uncounted anonymous mints.
export const FOCUS_REFRESH_MIN_MS = 60_000;
const DEFAULT_RETRY_AFTER_S = 60;

export type AuthStatus = 'unknown' | 'signed_in' | 'signed_out';

export type AgentTokenErrorKind = 'temporary' | 'rate_limited' | 'refused';

const UNAVAILABLE = 'Sign-in is temporarily unavailable. Please try again in a few minutes.';

const ERROR_MESSAGES: Record<AgentTokenErrorKind, string> = {
  temporary: UNAVAILABLE,
  rate_limited: UNAVAILABLE,
  refused: "Sign-in isn't available on this page.",
};

export class AgentTokenError extends Error {
  constructor(readonly kind: AgentTokenErrorKind) {
    super(ERROR_MESSAGES[kind]);
    this.name = 'AgentTokenError';
  }
}

interface HeldToken {
  value: string;
  deadline: number;
}

export interface AgentTokenSource {
  /**
   * A usable token, or null when the user is signed out. When the mint fails
   * for a user this page hasn't seen signed in, it resolves null too, so
   * anonymous chat keeps working while the identity site is unreachable;
   * `strict` rethrows instead. A user seen signed in always gets the error,
   * since an anonymous request would lose their thread.
   */
  getToken(options?: { strict?: boolean }): Promise<string | null>;
  /**
   * Mints again regardless of the held token. With `stale`, mints only if
   * that is still the held token, so requests that all got a 401 for the
   * same token share one re-mint.
   */
  refresh(stale?: string): Promise<string | null>;
  getStatus(): AuthStatus;
  /** The most recent mint failure, until a mint succeeds. */
  lastFailure(): AgentTokenErrorKind | null;
  /** Marks the chat as opened on this page, which arms the focus re-mint. */
  noteOpened(): void;
  /** Re-mints after the window regains focus, only while signed out. */
  refreshOnFocus(): void;
  subscribe(listener: () => void): () => void;
}

export function createAgentTokenSource({
  tokenUrl,
  now = Date.now,
  fetchImpl = (input, init) => fetch(input, init),
}: {
  tokenUrl: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}): AgentTokenSource {
  let held: HeldToken | null = null;
  // The last token handed out, kept after it expires so a late 401 for it
  // can be recognized as already handled.
  let issued: string | null = null;
  let status: AuthStatus = 'unknown';
  // A 429 also counts: the flood limit is per signed-in user, and
  // login_required mints aren't counted, so only a signed-in user gets one.
  let seenSignedIn = false;
  let inflight: Promise<string | null> | null = null;
  let failure: { error: AgentTokenError; until: number } | null = null;
  let opened = false;
  let lastFocusRefresh = Number.NEGATIVE_INFINITY;
  const listeners = new Set<() => void>();

  const setStatus = (next: AuthStatus) => {
    if (next === status) return;
    status = next;
    listeners.forEach((listener) => listener());
  };


  const notify = () => listeners.forEach((listener) => listener());

  const fail = (error: AgentTokenError, until: number): never => {
    failure = { error, until };
    // The status may be unchanged, but lastFailure() isn't.
    notify();
    throw error;
  };

  const requestToken = async (): Promise<string | null> => {
    let res: Response;
    try {
      res = await fetchImpl(tokenUrl, {
        method: 'POST',
        credentials: 'include',
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
    } catch {
      // Also how an unregistered or cross-site origin shows up: the identity
      // site sends no CORS headers, so the browser reports a network error.
      return fail(new AgentTokenError('temporary'), now() + FAILED_MINT_FLOOR_MS);
    }

    if (res.status === 401) {
      held = null;
      issued = null;
      seenSignedIn = false;
      failure = null;
      setStatus('signed_out');
      return null;
    }
    if (res.status === 429) {
      // Only the identity site's own flood limit, which counts signed-in
      // users only, proves the user is signed in. An edge proxy's 429 doesn't.
      const body: unknown = await res.json().catch(() => null);
      if ((body as { error?: unknown } | null)?.error === 'slow_down') seenSignedIn = true;
      const retryAfter = Number(res.headers.get('Retry-After'));
      const waitS = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_S;
      return fail(new AgentTokenError('rate_limited'), now() + waitS * 1000);
    }
    if (res.status === 403) {
      // Never retried: the origin isn't allowed, so nothing will change.
      return fail(new AgentTokenError('refused'), Number.POSITIVE_INFINITY);
    }

    const body: unknown = res.ok ? await res.json().catch(() => null) : null;
    const token = parseToken(body);
    if (!token) {
      return fail(new AgentTokenError('temporary'), now() + FAILED_MINT_FLOOR_MS);
    }
    // The deadline is local receipt time plus expires_in; `exp` is never read,
    // so a skewed local clock can't make a token look fresher than it is.
    held = { value: token.value, deadline: now() + token.expiresIn * 1000 };
    issued = token.value;
    seenSignedIn = true;
    failure = null;
    setStatus('signed_in');
    return held.value;
  };

  const mint = (): Promise<string | null> => {
    if (failure && now() < failure.until) {
      return Promise.reject(failure.error);
    }
    if (!inflight) {
      inflight = requestToken().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };

  const refresh = (stale?: string) => {
    if (stale !== undefined && stale !== issued) {
      // Already replaced. A mint still in flight (say, after the sign-in
      // popup closed) is the replacement, so wait for it.
      return inflight ?? Promise.resolve(held?.value ?? null);
    }
    held = null;
    if (failure && failure.error.kind === 'temporary') failure = null;
    return mint();
  };

  return {
    async getToken({ strict = false } = {}) {
      if (held && held.deadline - now() >= REFRESH_MARGIN_MS) {
        return held.value;
      }
      // Signed out stays signed out until refresh(), which the sign-in popup
      // and window focus trigger. Minting on every request would spend the
      // mint limit on anonymous chats.
      if (status === 'signed_out') return null;
      try {
        return await mint();
      } catch (e) {
        if (strict || seenSignedIn) throw e;
        return null;
      }
    },
    refresh,
    getStatus: () => status,
    lastFailure: () => failure?.error.kind ?? null,
    noteOpened() {
      opened = true;
    },
    refreshOnFocus() {
      if (!opened || status !== 'signed_out') return;
      if (now() - lastFocusRefresh < FOCUS_REFRESH_MIN_MS) return;
      lastFocusRefresh = now();
      refresh().catch(() => {});
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function parseToken(body: unknown): { value: string; expiresIn: number } | null {
  if (!body || typeof body !== 'object') return null;
  const { access_token, expires_in } = body as Record<string, unknown>;
  if (typeof access_token !== 'string' || !access_token) return null;
  if (typeof expires_in !== 'number' || !(expires_in > 0)) return null;
  return { value: access_token, expiresIn: expires_in };
}

const sources = new Map<string, AgentTokenSource>();

/**
 * The page's source for one identity site, shared by every bot instance in
 * this bundle that uses it. A separately bundled copy has its own.
 */
export function getAgentTokenSource(tokenUrl: string): AgentTokenSource {
  let source = sources.get(tokenUrl);
  if (!source) {
    source = createAgentTokenSource({ tokenUrl });
    sources.set(tokenUrl, source);
  }
  return source;
}
