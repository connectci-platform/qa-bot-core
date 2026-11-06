/**
 * Stub fetch responses for flow tests. jsdom's Response has no stream body,
 * so these implement only what qa-flow reads: ok, status, headers.get,
 * json() and body.getReader().
 */

export type SseEvent = { event: string; data: unknown };

interface StubInit {
  status?: number;
  contentType?: string;
}

function stubResponse(body: string, { status = 200, contentType = 'application/json' }: StubInit = {}) {
  const chunks = [new TextEncoder().encode(body)];
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => JSON.parse(body),
    body: {
      getReader: () => ({
        read: async () =>
          chunks.length ? { done: false, value: chunks.shift() } : { done: true, value: undefined },
      }),
    },
  } as unknown as Response;
}

export function sseResponse(events: SseEvent[], init: StubInit = {}): Response {
  const body = events.map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return stubResponse(body, { ...init, contentType: 'text/event-stream' });
}

export function jsonResponse(data: unknown, init: StubInit = {}): Response {
  return stubResponse(JSON.stringify(data), init);
}

/** A finished agent answer: one token and a done event marked rateable. */
export function agentAnswer(text = 'An answer.', extra: SseEvent[] = []): Response {
  return sseResponse([
    { event: 'token', data: { content: text } },
    ...extra,
    { event: 'done', data: { metadata: { rating_target: 'agent', is_final_response: true } } },
  ]);
}
