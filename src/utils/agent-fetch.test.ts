import { agentFetch, isAgentRequest, resolveAgentAuth } from './agent-fetch';
import type { AgentTokenSource } from './agent-token';
import type { AgentAuthConfig } from '../config';

const CONFIG: AgentAuthConfig = {
  tokenUrl: 'https://support.example/api/agent-token',
  loginUrl: 'https://support.example/user/login',
  agentUrl: 'https://agent.example',
};
const PAGE = 'https://site.example/docs/page';

function fakeSource(token: string | null, refreshed: string | null = 't2') {
  return {
    getToken: jest.fn().mockResolvedValue(token),
    refresh: jest.fn().mockResolvedValue(refreshed),
    getStatus: () => 'unknown' as const,
    lastFailure: () => null,
    noteOpened: () => {},
    refreshOnFocus: () => {},
    subscribe: () => () => {},
  } satisfies AgentTokenSource;
}

const status = (code: number) => ({ status: code, ok: code < 400 }) as Response;
const authOf = (init: RequestInit | undefined) => new Headers(init?.headers).get('Authorization');

describe('resolveAgentAuth', () => {
  const at = (href: string) => new URL(href);

  it('returns null when there is no config', () => {
    expect(resolveAgentAuth(undefined, at(PAGE))).toBeNull();
  });

  it('accepts an https agent', () => {
    expect(resolveAgentAuth(CONFIG, at(PAGE))).toBe(CONFIG);
  });

  it('refuses an http agent on a page that is not loopback', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveAgentAuth({ ...CONFIG, agentUrl: 'http://localhost:8000' }, at(PAGE))).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it.each(['http://localhost:3000/', 'http://127.0.0.1:3000/', 'http://[::1]:3000/'])(
    'allows an http agent on a loopback page (%s)',
    (page) => {
      const config = { ...CONFIG, agentUrl: 'http://localhost:8000' };
      expect(resolveAgentAuth(config, at(page))).toBe(config);
    },
  );

  it('refuses an http token URL on a page that is not loopback', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveAgentAuth({ ...CONFIG, tokenUrl: 'http://support.example/api/agent-token' }, at(PAGE))).toBeNull();
    error.mockRestore();
  });

  it('refuses a config whose URLs do not parse', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(resolveAgentAuth({ ...CONFIG, tokenUrl: 'not a url' }, at(PAGE))).toBeNull();
    error.mockRestore();
  });
});

describe('isAgentRequest', () => {
  it.each([
    ['https://agent.example/api/v1/query', true],
    ['https://agent.example:443/api/v1/rating', true],
    ['https://rag.example/chat', false],
    ['http://agent.example/api/v1/query', false],
    ['/api/chat', false],
  ])('%s -> %s', (url, expected) => {
    expect(isAgentRequest(CONFIG, url, PAGE)).toBe(expected);
  });

  it('matches a relative endpoint when the agent is the page origin', () => {
    expect(isAgentRequest({ ...CONFIG, agentUrl: 'https://site.example' }, '/api/v1/query', PAGE)).toBe(true);
  });
});

describe('agentFetch', () => {
  const init = (): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: '{"a":1}',
  });

  it('sends a request for another origin exactly as given, with no token', async () => {
    const source = fakeSource('t1');
    const fetchImpl = jest.fn().mockResolvedValue(status(200));
    const given = init();

    await agentFetch(source, CONFIG, 'https://rag.example/chat', given, { fetchImpl, base: PAGE });

    expect(fetchImpl).toHaveBeenCalledWith('https://rag.example/chat', given);
    expect(fetchImpl.mock.calls[0][1]).toBe(given);
    expect(source.getToken).not.toHaveBeenCalled();
  });

  it('adds the token and drops cookies for the agent', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(status(200));

    await agentFetch(fakeSource('t1'), CONFIG, 'https://agent.example/api/v1/query', init(), {
      fetchImpl,
      base: PAGE,
    });

    const sent = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(authOf(sent)).toBe('Bearer t1');
    expect(new Headers(sent.headers).get('Content-Type')).toBe('application/json');
    expect(sent.credentials).toBe('omit');
    expect(sent.body).toBe('{"a":1}');
  });

  it('sends no Authorization when signed out', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(status(200));

    await agentFetch(fakeSource(null), CONFIG, 'https://agent.example/api/v1/query', init(), {
      fetchImpl,
      base: PAGE,
    });

    const sent = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(authOf(sent)).toBeNull();
    expect(sent.credentials).toBe('omit');
  });

  it('passes strict to the token source', async () => {
    const source = fakeSource('t1');

    await agentFetch(source, CONFIG, 'https://agent.example/q', init(), {
      fetchImpl: jest.fn().mockResolvedValue(status(200)),
      base: PAGE,
      strict: true,
    });

    expect(source.getToken).toHaveBeenCalledWith({ strict: true });
  });

  it('propagates a mint failure so the request is not sent', async () => {
    const source = fakeSource('t1');
    source.getToken.mockRejectedValue(new Error('mint failed'));
    const fetchImpl = jest.fn();

    await expect(
      agentFetch(source, CONFIG, 'https://agent.example/q', init(), { fetchImpl, base: PAGE }),
    ).rejects.toThrow('mint failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-mints once on a 401 and replays with the new token', async () => {
    const source = fakeSource('t1', 't2');
    const fetchImpl = jest.fn().mockResolvedValueOnce(status(401)).mockResolvedValueOnce(status(200));

    const res = await agentFetch(source, CONFIG, 'https://agent.example/q', init(), { fetchImpl, base: PAGE });

    expect(res.status).toBe(200);
    expect(source.refresh).toHaveBeenCalledWith('t1');
    const replay = fetchImpl.mock.calls[1][1] as RequestInit;
    expect(authOf(replay)).toBe('Bearer t2');
    expect(replay.body).toBe('{"a":1}');
  });

  it('returns the second 401 instead of retrying again', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(status(401));

    const res = await agentFetch(fakeSource('t1'), CONFIG, 'https://agent.example/q', init(), {
      fetchImpl,
      base: PAGE,
    });

    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends no cookies on the replay either', async () => {
    const fetchImpl = jest.fn().mockResolvedValueOnce(status(401)).mockResolvedValueOnce(status(200));

    await agentFetch(fakeSource('t1', 't2'), CONFIG, 'https://agent.example/q', init(), { fetchImpl, base: PAGE });

    expect((fetchImpl.mock.calls[1][1] as RequestInit).credentials).toBe('omit');
  });

  it('does not replay when the re-mint says signed out', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(status(401));

    await agentFetch(fakeSource('t1', null), CONFIG, 'https://agent.example/q', init(), {
      fetchImpl,
      base: PAGE,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not re-mint for a 401 to a request that sent no token', async () => {
    const source = fakeSource(null);
    const fetchImpl = jest.fn().mockResolvedValue(status(401));

    await agentFetch(source, CONFIG, 'https://agent.example/q', init(), { fetchImpl, base: PAGE });

    expect(source.refresh).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not replay a body that cannot be sent twice', async () => {
    const source = fakeSource('t1');
    const fetchImpl = jest.fn().mockResolvedValue(status(401));

    await agentFetch(source, CONFIG, 'https://agent.example/q', { ...init(), body: new Blob(['x']) }, {
      fetchImpl,
      base: PAGE,
    });

    expect(source.refresh).not.toHaveBeenCalled();
  });

  it.each([500, 503, 404, 409])('does not replay a %s', async (code) => {
    const source = fakeSource('t1');
    const fetchImpl = jest.fn().mockResolvedValue(status(code));

    const res = await agentFetch(source, CONFIG, 'https://agent.example/q', init(), { fetchImpl, base: PAGE });

    expect(res.status).toBe(code);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(source.refresh).not.toHaveBeenCalled();
  });
});
