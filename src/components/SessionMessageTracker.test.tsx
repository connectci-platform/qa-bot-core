import React from 'react';
import { render } from '@testing-library/react';
import SessionMessageTracker from './SessionMessageTracker';
import { SessionProvider } from '../contexts/SessionContext';
import { getSessionMessages } from '../utils/session-utils';

const SESSION_ID = 'qa_bot_session_test-stream';

const renderTracker = () =>
  render(
    <SessionProvider
      getSessionId={() => SESSION_ID}
      setSessionId={() => {}}
      resetSession={() => {}}
      clearResettingFlag={() => {}}
    >
      <SessionMessageTracker />
    </SessionProvider>
  );

const dispatchEvent = (name: string, message: unknown) => {
  const event = new CustomEvent(name) as Event & { data?: unknown };
  (event as { data?: unknown }).data = { message };
  window.dispatchEvent(event);
};

beforeEach(() => {
  localStorage.clear();
});

describe('SessionMessageTracker', () => {
  it('stores user messages injected via rcb-pre-inject-message', () => {
    renderTracker();

    dispatchEvent('rcb-pre-inject-message', {
      id: 'u1',
      content: 'How do I request an allocation?',
      sender: 'USER',
      type: 'string',
    });

    const stored = getSessionMessages(SESSION_ID);
    expect(stored.map((m) => m.content)).toContain('How do I request an allocation?');
  });

  it('stores streamed bot answers finalized via rcb-stop-stream-message', () => {
    renderTracker();

    // A streamed bot answer never fires rcb-pre-inject-message; it is
    // finalized with rcb-stop-stream-message carrying the full message.
    dispatchEvent('rcb-stop-stream-message', {
      id: 'b1',
      content: 'You request an allocation through the ACCESS allocations portal...',
      sender: 'BOT',
      type: 'string',
    });

    const stored = getSessionMessages(SESSION_ID);
    expect(stored.map((m) => m.content)).toContain(
      'You request an allocation through the ACCESS allocations portal...'
    );
  });

  it('skips a message marked transient', () => {
    renderTracker();

    dispatchEvent('rcb-pre-inject-message', {
      id: 't1',
      content: <div data-transient>Sign in to continue.</div>,
      sender: 'BOT',
      type: 'object',
    });

    expect(getSessionMessages(SESSION_ID)).toEqual([]);
  });

  it('still stores a component message that is not transient', () => {
    renderTracker();

    dispatchEvent('rcb-pre-inject-message', {
      id: 'c1',
      content: <div>A saved component answer</div>,
      sender: 'BOT',
      type: 'object',
    });

    expect(getSessionMessages(SESSION_ID).map((m) => m.content)).toContain('A saved component answer');
  });
});

describe('transient messages inside a wrapper', () => {
  it('skips a transient element that react-chatbotify wrapped', () => {
    renderTracker();

    dispatchEvent('rcb-pre-inject-message', {
      id: 't2',
      content: <div className="rcb-bot-message"><span data-transient>Changes aren't available here.</span></div>,
      sender: 'BOT',
      type: 'object',
    });

    expect(getSessionMessages(SESSION_ID)).toEqual([]);
  });
});
