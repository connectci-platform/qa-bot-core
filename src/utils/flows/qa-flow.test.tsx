import { createQAFlow } from './qa-flow';
import { agentAnswer, jsonResponse } from '../../test-utils/sse';

const QUERY = 'https://agent.example/api/v1/query';
const AGENT_RATING = 'https://agent.example/api/v1/rating';
const RAG_RATING = 'https://rag.example/rating';

function chatState(userInput: string) {
  return {
    userInput,
    injectMessage: jest.fn(async () => {}),
    streamMessage: jest.fn(async () => {}),
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
