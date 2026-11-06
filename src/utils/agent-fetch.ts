import type { AgentAuthConfig } from '../config';
import type { AgentTokenSource } from './agent-token';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The config if it is safe to use, or null. The agent and the token URL must
 * be https unless the page itself is on loopback, so a build that kept a
 * localhost default can't send or receive tokens in the clear.
 */
export function resolveAgentAuth(
  config: AgentAuthConfig | undefined,
  location: Pick<URL, 'href' | 'hostname'>,
): AgentAuthConfig | null {
  if (!config) return null;
  let agent: URL;
  let token: URL;
  try {
    agent = new URL(config.agentUrl);
    token = new URL(config.tokenUrl);
    new URL(config.loginUrl);
  } catch {
    console.error('qa-bot-core: agentAuth has a URL that does not parse; agent sign-in is off.');
    return null;
  }
  const insecure = agent.protocol !== 'https:' || token.protocol !== 'https:';
  if (insecure && !LOOPBACK_HOSTS.has(location.hostname)) {
    console.error('qa-bot-core: agentAuth.agentUrl and tokenUrl must be https; agent sign-in is off.');
    return null;
  }
  return config;
}

/** Whether `url`, resolved against the page, is on the agent's origin. */
export function isAgentRequest(
  config: AgentAuthConfig,
  url: string,
  base: string = window.location.href,
): boolean {
  try {
    return new URL(url, base).origin === new URL(config.agentUrl).origin;
  } catch {
    return false;
  }
}

/**
 * The one way an agent request gets a token. A request for any other origin
 * is sent exactly as given. An agent request sends no cookies, carries the
 * current token (or none when signed out), and after a 401 is sent once more
 * with a re-minted token. The agent answers 401 before it starts a run, so
 * that is the one safe automatic retry; anything else is returned as it came.
 */
export async function agentFetch(
  source: AgentTokenSource,
  config: AgentAuthConfig,
  url: string,
  init: RequestInit = {},
  {
    strict = false,
    fetchImpl = (input, init) => fetch(input, init),
    base,
  }: { strict?: boolean; fetchImpl?: typeof fetch; base?: string } = {},
): Promise<Response> {
  if (!isAgentRequest(config, url, base)) {
    return fetchImpl(url, init);
  }

  // 'omit', not just dropped: the default is same-origin, which would still
  // send the page's cookies to an agent on the page's own origin.
  const withoutCookies: RequestInit = { ...init, credentials: 'omit' };
  const token = await source.getToken({ strict });
  const first = withBearer(withoutCookies, token);
  const res = await fetchImpl(url, first);
  if (res.status !== 401 || !token) return res;
  if (first.body != null && typeof first.body !== 'string') return res;

  const fresh = await source.refresh(token);
  if (!fresh) return res;
  return fetchImpl(url, withBearer(withoutCookies, fresh));
}

function withBearer(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    headers.delete('Authorization');
  }
  return { ...init, headers };
}
