import React from 'react';
import { createQAFlow } from './qa-flow';
import { AgentTokenError } from '../agent-token';
import type { AgentTokenSource, AuthStatus } from '../agent-token';
import { agentAnswer, jsonResponse, sseResponse } from '../../test-utils/sse';

const QUERY = 'https://agent.example/api/v1/query';
const AGENT_RATING = 'https://agent.example/api/v1/rating';
const RAG_RATING = 'https://rag.example/rating';

function chatState(userInput: string) {
  return {
    userInput,
    injectMessage: jest.fn(async (_message: unknown) => {}),
    streamMessage: jest.fn(async (_message: unknown) => {}),
    endStreamMessage: jest.fn(async () => {}),
  };
}

function makeFlow(overrides: Partial<Parameters<typeof createQAFlow>[0]> = {}) {
  return createQAFlow({
    endpoint: QUERY,
    ratingEndpoint: RAG_RATING,
    agentRatingEndpoint: AGENT_RATING,
    apiKey: 'key',
    sessionId: () => 'session-1',
    isLoggedIn: true,
    ...overrides,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const send = (flow: any, text: string) => flow.qa_loop.message(chatState(text));

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});

describe('request shapes without agent auth', () => {
  it('sends the query with cookies and no Authorization', async () => {
    fetchMock.mockResolvedValueOnce(agentAnswer());

    await send(makeFlow(), 'What is ACCESS?');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(QUERY);
    expect(init).toEqual({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': 'key',
        'X-Session-ID': 'session-1',
        'X-Query-ID': expect.any(String),
        'X-Origin': 'access',
      },
      credentials: 'include',
      body: expect.any(String),
    });
    expect(JSON.parse(init.body)).toEqual({
      query: 'What is ACCESS?',
      question_id: init.headers['X-Query-ID'],
      session_id: 'session-1',
    });
  });

  it('sends the agent rating with cookies and no Authorization', async () => {
    const flow = makeFlow();
    fetchMock.mockResolvedValueOnce(agentAnswer());
    await send(flow, 'What is ACCESS?');
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await send(flow, '👍 Helpful');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(AGENT_RATING);
    expect(init).toEqual({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': 'key',
        'X-Session-ID': 'session-1',
        'X-Query-ID': expect.any(String),
      },
      credentials: 'include',
      body: expect.any(String),
    });
    expect(JSON.parse(init.body)).toEqual({
      query_id: init.headers['X-Query-ID'],
      rating: 'helpful',
      session_id: 'session-1',
    });
  });

  it('sends the Turnstile resubmit with cookies and no Authorization', async () => {
    const flow = makeFlow();
    fetchMock.mockResolvedValueOnce(jsonResponse({ requires_turnstile: true, site_key: 'site' }));
    await send(flow, 'What is ACCESS?');
    fetchMock.mockResolvedValueOnce(agentAnswer());

    const result = await flow.qa_loop.component.props.onResubmit('turnstile-token');

    expect(result).toBe('success');
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(QUERY);
    expect(init).toEqual({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': 'key',
        'X-Session-ID': 'session-1',
        'X-Query-ID': expect.any(String),
        'X-Origin': 'access',
      },
      credentials: 'include',
      body: expect.any(String),
    });
    expect(JSON.parse(init.body)).toMatchObject({
      query: 'What is ACCESS?',
      turnstile_token: 'turnstile-token',
      session_id: 'session-1',
    });
  });

  it('ignores a requires_auth event', async () => {
    const state = chatState('Register me for the workshop');
    fetchMock.mockResolvedValueOnce(
      agentAnswer('You need to sign in for that.', [
        { event: 'requires_auth', data: { reason: 'write_action', login_url: '/login' } },
      ]),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (makeFlow() as any).qa_loop.message(state);

    expect(state.injectMessage).not.toHaveBeenCalled();
  });

  it('gates a logged-out user when anonymous access is off', () => {
    const flow = makeFlow({ isLoggedIn: false });

    expect(flow.qa_loop.chatDisabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Agent mode ─────────────────────────────────────────────────────────

function fakeAgent({
  status = 'signed_in' as AuthStatus,
  token = 't1' as string | null,
  failure = null as ReturnType<AgentTokenSource['lastFailure']>,
} = {}) {
  const listeners = new Set<() => void>();
  let current = status;
  const source = {
    getToken: jest.fn(async () => token),
    refresh: jest.fn(async () => token),
    getStatus: () => current,
    lastFailure: () => failure,
    noteOpened: () => {},
    refreshOnFocus: () => {},
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
  const agent = {
    config: {
      tokenUrl: 'https://support.example/api/agent-token',
      loginUrl: 'https://support.example/user/login',
      agentUrl: 'https://agent.example',
    },
    source,
    ensureStatus: jest.fn(async () => current),
    requestReset: jest.fn(),
    signInButton: () => <button>Sign in</button>,
    hostEnabled: jest.fn(() => true),
    resetGeneration: jest.fn(() => 0),
  };
  const setStatus = (next: AuthStatus) => {
    current = next;
    listeners.forEach((l) => l());
  };
  return { agent, source, setStatus };
}

const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as { props?: { children?: unknown } }).props?.children);
};
const isTransient = (node: unknown) =>
  !!node && typeof node === 'object' && (node as { props?: Record<string, unknown> }).props?.['data-transient'] === true;

describe('agent mode requests', () => {
  it('sends the token to the agent and no cookies', async () => {
    const { agent } = fakeAgent();
    fetchMock.mockResolvedValueOnce(agentAnswer());

    await send(makeFlow({ agent }), 'What is ACCESS?');

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t1');
    expect(init.credentials).toBe('omit');
  });

  it('never sends the token to an endpoint on another origin', async () => {
    const { agent } = fakeAgent();
    fetchMock.mockResolvedValueOnce(agentAnswer());

    await send(makeFlow({ agent, endpoint: 'https://rag.example/chat' }), 'What is ACCESS?');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('signs the agent rating and leaves the RAG rating alone', async () => {
    const { agent } = fakeAgent();
    const flow = makeFlow({ agent });
    fetchMock.mockResolvedValueOnce(agentAnswer());
    await send(flow, 'What is ACCESS?');
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await send(flow, '👍 Helpful');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(AGENT_RATING);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t1');
  });
});

describe('agent mode gate', () => {
  it('waits for the sign-in status before sending', async () => {
    const { agent } = fakeAgent();
    fetchMock.mockResolvedValueOnce(agentAnswer());

    await send(makeFlow({ agent }), 'What is ACCESS?');

    expect(agent.ensureStatus).toHaveBeenCalled();
    expect(agent.ensureStatus.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it('asks a signed-out user to sign in when anonymous access is off', async () => {
    const { agent } = fakeAgent({ status: 'signed_out', token: null });
    const state = chatState('What is ACCESS?');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (makeFlow({ agent }) as any).qa_loop.message(state);

    expect(fetchMock).not.toHaveBeenCalled();
    const shown = state.injectMessage.mock.calls[0][0];
    expect(textOf(shown)).toContain('Sign in');
    expect(isTransient(shown)).toBe(true);
  });

  it('sends a signed-out user anonymously when anonymous access is on', async () => {
    const { agent } = fakeAgent({ status: 'signed_out', token: null });
    fetchMock.mockResolvedValueOnce(agentAnswer());

    await send(makeFlow({ agent, allowAnonAccess: true }), 'What is ACCESS?');

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('says sign-in is unavailable when the mint failed and anonymous access is off', async () => {
    const { agent } = fakeAgent({ status: 'unknown', token: null, failure: 'temporary' });

    const reply = await send(makeFlow({ agent }), 'What is ACCESS?');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reply).toBe(new AgentTokenError('temporary').message);
  });

  it('sends anonymously after a quiet mint failure when anonymous access is on', async () => {
    const { agent } = fakeAgent({ status: 'unknown', token: null, failure: 'temporary' });
    fetchMock.mockResolvedValueOnce(agentAnswer());

    await send(makeFlow({ agent, allowAnonAccess: true }), 'What is ACCESS?');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send when the mint fails for a signed-in user', async () => {
    const { agent, source } = fakeAgent();
    source.getToken.mockRejectedValue(new AgentTokenError('rate_limited'));

    const reply = await send(makeFlow({ agent, allowAnonAccess: true }), 'What is ACCESS?');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(reply).toBe(new AgentTokenError('rate_limited').message);
  });

  it('starts over instead of sending when a signed-in user has been signed out', async () => {
    const { agent } = fakeAgent({ status: 'signed_in', token: null });

    const reply = await send(makeFlow({ agent, allowAnonAccess: true }), 'What is ACCESS?');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(agent.requestReset).toHaveBeenCalledWith('signed_out');
    expect(reply).toBeUndefined();
  });

  it('refuses to send while the host has disabled the bot', async () => {
    const { agent } = fakeAgent();
    agent.hostEnabled.mockReturnValue(false);

    const reply = await send(makeFlow({ agent }), 'What is ACCESS?');

    expect(reply).toBe('To ask questions, please log in first.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores the host isLoggedIn', () => {
    const { agent } = fakeAgent();

    const flow = makeFlow({ agent, isLoggedIn: false });

    expect(flow.qa_loop.chatDisabled).toBe(false);
  });
});

describe('agent mode responses', () => {
  it('starts a new conversation when the agent no longer knows the thread', async () => {
    const { agent } = fakeAgent();
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Thread not found' }, { status: 404 }));

    const reply = await send(makeFlow({ agent }), 'What is ACCESS?');

    expect(agent.requestReset).toHaveBeenCalledWith('thread_lost');
    expect(reply).toBeUndefined();
  });

  it('treats any other 404 as an ordinary error, not a lost thread', async () => {
    const { agent } = fakeAgent();
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Not Found' }, { status: 404 }));

    const reply = await send(makeFlow({ agent }), 'What is ACCESS?');

    expect(agent.requestReset).not.toHaveBeenCalled();
    expect(reply).toMatch(/trouble processing/);
  });

  it.each([404, 409, 503])('reads a %s from an endpoint that is not the agent as an ordinary error', async (code) => {
    const { agent } = fakeAgent();
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'Thread not found' }, { status: code }));

    const reply = await send(makeFlow({ agent, endpoint: 'https://rag.example/chat' }), 'What is ACCESS?');

    expect(agent.requestReset).not.toHaveBeenCalled();
    expect(reply).toMatch(/trouble processing/);
  });

  it('stops writing a streamed answer once the conversation is reset', async () => {
    const { agent } = fakeAgent();
    const state = chatState('What is ACCESS?');
    agent.resetGeneration.mockReturnValueOnce(0).mockReturnValue(1);
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { event: 'token', data: { content: 'first ' } },
        { event: 'token', data: { content: 'second' } },
        { event: 'requires_auth', data: { reason: 'write_action' } },
        { event: 'done', data: { metadata: {} } },
      ]),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (makeFlow({ agent }) as any).qa_loop.message(state);

    expect(state.streamMessage).not.toHaveBeenCalled();
    expect(state.injectMessage).not.toHaveBeenCalled();
  });

  it('says it is still answering on a 409', async () => {
    const { agent } = fakeAgent();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 409 }));

    expect(await send(makeFlow({ agent }), 'Again?')).toBe('Still answering your last question.');
  });

  it('shows a temporary error on a 503 without a new token', async () => {
    const { agent, source } = fakeAgent();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 503 }));

    const reply = await send(makeFlow({ agent }), 'What is ACCESS?');

    expect(reply).toBe('The assistant is temporarily unavailable. Please try again in a few minutes.');
    expect(source.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['write_action', 'Sign in to continue.', true],
    ['private_data', 'Sign in to continue.', true],
    ['write_scope', "Changes aren't available here.", false],
  ])('after the reply, explains a %s refusal', async (reason, text, hasButton) => {
    const { agent } = fakeAgent();
    const state = chatState('Register me');
    fetchMock.mockResolvedValueOnce(
      agentAnswer('I can’t do that here.', [{ event: 'requires_auth', data: { reason } }]),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (makeFlow({ agent }) as any).qa_loop.message(state);

    expect(state.endStreamMessage.mock.invocationCallOrder[0]).toBeLessThan(
      state.injectMessage.mock.invocationCallOrder[0],
    );
    const shown = state.injectMessage.mock.calls[0][0];
    expect(isTransient(shown)).toBe(true);
    expect(textOf(shown)).toContain(text);
    expect(textOf(shown).includes('Sign in') && reason !== 'write_scope').toBe(hasButton);
  });

  it('uses the configured sign-in text', async () => {
    const { agent } = fakeAgent();
    const state = chatState('Register me');
    fetchMock.mockResolvedValueOnce(
      agentAnswer('No.', [{ event: 'requires_auth', data: { reason: 'write_action' } }]),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (makeFlow({ agent: { ...agent, config: { ...agent.config, signInText: 'Use your ACCESS account.' } } }) as any).qa_loop.message(state);

    expect(textOf(state.injectMessage.mock.calls[0][0])).toContain('Use your ACCESS account.');
  });

  it('explains a refusal after a Turnstile resubmit too', async () => {
    const { agent } = fakeAgent({ status: 'unknown', token: null });
    const state = chatState('Register me');
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ requires_turnstile: true, site_key: 'site' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (flow as any).qa_loop.message(state);
    fetchMock.mockResolvedValueOnce(
      agentAnswer('You need to sign in.', [{ event: 'requires_auth', data: { reason: 'write_action' } }]),
    );

    await flow.qa_loop.component.props.onResubmit('turnstile-token');

    const calls = state.injectMessage.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe('You need to sign in.');
    expect(isTransient(calls[1])).toBe(true);
  });
});

describe('agent mode Turnstile fixes', () => {
  const challenge = () => jsonResponse({ requires_turnstile: true, site_key: 'site' });

  it('resends once even when several challenges were registered', async () => {
    const { agent, setStatus } = fakeAgent({ status: 'signed_out', token: null });
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(challenge()).mockResolvedValueOnce(challenge());
    await send(flow, 'Q1');
    await send(flow, 'Q2');
    agent.source.getToken.mockResolvedValue('t1');
    fetchMock.mockResolvedValue(agentAnswer());

    setStatus('signed_in');
    setStatus('signed_out');
    setStatus('signed_in');
    await new Promise((r) => setTimeout(r, 0));

    const resends = fetchMock.mock.calls.slice(2).map(([, init]) => JSON.parse(init.body).query);
    expect(resends).toEqual(['Q2']);
  });

  it('does not resend a question from a conversation that was reset', async () => {
    let sessionId = 'session-1';
    const { agent, setStatus } = fakeAgent({ status: 'signed_out', token: null });
    const flow = makeFlow({ agent, allowAnonAccess: true, sessionId: () => sessionId });
    fetchMock.mockResolvedValueOnce(challenge());
    await send(flow, 'Old question');
    sessionId = 'session-2';
    agent.source.getToken.mockResolvedValue('t1');

    setStatus('signed_in');
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not let the widget and a sign-in send the same question twice', async () => {
    const { agent, setStatus } = fakeAgent({ status: 'signed_out', token: null });
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(challenge());
    await send(flow, 'What is ACCESS?');
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { release = r; }));
    agent.source.getToken.mockResolvedValue('t1');

    const fromWidget = flow.qa_loop.component.props.onResubmit('turnstile-token');
    setStatus('signed_in');
    await new Promise((r) => setTimeout(r, 0));
    release(agentAnswer());
    await fromWidget;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the refusal when the resent answer has no text', async () => {
    const { agent } = fakeAgent({ status: 'unknown', token: null });
    const state = chatState('Register me');
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(challenge());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (flow as any).qa_loop.message(state);
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { event: 'requires_auth', data: { reason: 'write_action' } },
        { event: 'done', data: { metadata: {} } },
      ]),
    );

    await flow.qa_loop.component.props.onResubmit('turnstile-token');

    const shown = state.injectMessage.mock.calls.map((c) => c[0]);
    expect(shown.some(isTransient)).toBe(true);
  });
});

describe('agent mode Turnstile, third round', () => {
  const challenge = (key = 'site') => jsonResponse({ requires_turnstile: true, site_key: key });

  it('tells the widget to wait, not to give up, while a sign-in resend is running', async () => {
    const { agent, setStatus } = fakeAgent({ status: 'signed_out', token: null });
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(challenge());
    await send(flow, 'What is ACCESS?');
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { release = r; }));
    agent.source.getToken.mockResolvedValue('t1');

    setStatus('signed_in');
    await new Promise((r) => setTimeout(r, 0));
    const fromWidget = await flow.qa_loop.component.props.onResubmit('turnstile-token');
    release(agentAnswer());

    expect(fromWidget).toBe('busy');
  });

  it('shows the widget again when the agent challenges once more with the same site key', async () => {
    const { agent } = fakeAgent({ status: 'unknown', token: null });
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(challenge());
    await send(flow, 'What is ACCESS?');
    const before = flow.qa_loop.component.props.getState().challenge;
    fetchMock.mockResolvedValueOnce(challenge());

    const result = await flow.qa_loop.component.props.onResubmit('turnstile-token');

    expect(result).toBe('needs_another_challenge');
    expect(flow.qa_loop.component.props.getState().challenge).not.toBe(before);
  });

  it('resends with the token when a widget resend comes back challenged after sign-in', async () => {
    const { agent, setStatus } = fakeAgent({ status: 'signed_out', token: null });
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(challenge());
    await send(flow, 'What is ACCESS?');
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => { release = r; }));
    const fromWidget = flow.qa_loop.component.props.onResubmit('turnstile-token');
    await new Promise((r) => setTimeout(r, 0));
    agent.source.getToken.mockResolvedValue('t1');
    setStatus('signed_in');
    fetchMock.mockResolvedValueOnce(agentAnswer('Signed-in answer.'));

    release(challenge());
    await fromWidget;

    const [, init] = fetchMock.mock.calls[2];
    expect(JSON.parse(init.body).turnstile_token).toBeUndefined();
  });

  it('does not send a widget resend for a conversation that was reset', async () => {
    let sessionId = 'session-1';
    const { agent } = fakeAgent({ status: 'unknown', token: null });
    const state = chatState('Old question');
    const flow = makeFlow({ agent, allowAnonAccess: true, sessionId: () => sessionId });
    fetchMock.mockResolvedValueOnce(challenge());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (flow as any).qa_loop.message(state);
    sessionId = 'session-2';

    await flow.qa_loop.component.props.onResubmit('turnstile-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.injectMessage).not.toHaveBeenCalled();
  });

  it('does not show a widget resend answer in a conversation reset while it ran', async () => {
    let sessionId = 'session-1';
    const { agent } = fakeAgent({ status: 'unknown', token: null });
    const state = chatState('Old question');
    const flow = makeFlow({ agent, allowAnonAccess: true, sessionId: () => sessionId });
    fetchMock.mockResolvedValueOnce(challenge());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (flow as any).qa_loop.message(state);
    fetchMock.mockImplementationOnce(async () => {
      sessionId = 'session-2';
      return agentAnswer('Old answer');
    });

    await flow.qa_loop.component.props.onResubmit('turnstile-token');

    expect(state.injectMessage).not.toHaveBeenCalled();
  });

  it('does not send a question whose conversation was reset before the request', async () => {
    const { agent } = fakeAgent();
    agent.resetGeneration.mockReturnValueOnce(0).mockReturnValue(1);

    await send(makeFlow({ agent }), 'What is ACCESS?');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Turnstile without agent auth', () => {
  it('does not give the widget a subscription', () => {
    expect(makeFlow().qa_loop.component.props.subscribe).toBeUndefined();
  });
});

describe('agent mode Turnstile', () => {
  it('sends the pending question with the token once the user signs in', async () => {
    const { agent, setStatus } = fakeAgent({ status: 'signed_out', token: null });
    const state = chatState('What is ACCESS?');
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ requires_turnstile: true, site_key: 'site' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (flow as any).qa_loop.message(state);
    agent.source.getToken.mockResolvedValue('t1');
    fetchMock.mockResolvedValueOnce(agentAnswer('Here it is.'));

    setStatus('signed_in');
    await new Promise((r) => setTimeout(r, 0));

    const [, init] = fetchMock.mock.calls[1];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer t1');
    expect(JSON.parse(init.body).turnstile_token).toBeUndefined();
    expect(state.injectMessage).toHaveBeenCalledWith('Here it is.');
    expect(flow.qa_loop.component.props.getState().siteKey).toBeNull();
  });

  it('tells the widget to re-render when the challenge is dropped', async () => {
    const { agent, setStatus } = fakeAgent({ status: 'signed_out', token: null });
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ requires_turnstile: true, site_key: 'site' }));
    await send(flow, 'What is ACCESS?');
    const rerender = jest.fn();
    flow.qa_loop.component.props.subscribe(rerender);
    agent.source.getToken.mockResolvedValue('t1');
    fetchMock.mockResolvedValueOnce(agentAnswer());

    setStatus('signed_in');
    await new Promise((r) => setTimeout(r, 0));

    expect(rerender).toHaveBeenCalled();
  });

  it('brings the challenge back if the signed-in resend is challenged again', async () => {
    const { agent, setStatus } = fakeAgent({ status: 'signed_out', token: null });
    const flow = makeFlow({ agent, allowAnonAccess: true });
    fetchMock.mockResolvedValueOnce(jsonResponse({ requires_turnstile: true, site_key: 'site' }));
    await send(flow, 'What is ACCESS?');
    fetchMock.mockResolvedValueOnce(jsonResponse({ requires_turnstile: true, site_key: 'site2' }));

    setStatus('signed_in');
    await new Promise((r) => setTimeout(r, 0));

    expect(flow.qa_loop.component.props.getState().siteKey).toBe('site2');
    expect(flow.qa_loop.component.props.getState().pendingQuery).not.toBeNull();
  });
});
