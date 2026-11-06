import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import QABot from './QABot';
import type { BotControllerHandle } from '../config';

jest.mock('../config', () => require('../test-utils/config-without-stream').default());

const settle = (ms = 50) => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, ms));
});

function renderBot(props: Partial<React.ComponentProps<typeof QABot>> = {}) {
  const ref = React.createRef<BotControllerHandle>();
  const view = render(
    <QABot
      ref={ref}
      apiKey="key"
      isLoggedIn={true}
      qaEndpoint="https://agent.example/api/v1/query"
      embedded
      welcomeMessage="Welcome to the bot"
      {...props}
    />,
  );
  return { ...view, ref };
}

const headerLogin = () => document.querySelector('.qa-bot-header-login-button');

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});

describe('sign-in state without agent auth', () => {
  it('shows the welcome', async () => {
    renderBot();
    await settle();

    expect(screen.getByText('Welcome to the bot')).toBeInTheDocument();
  });

  it('follows isLoggedIn in the header', async () => {
    const view = renderBot({ isLoggedIn: false });
    await settle();
    expect(headerLogin()).toBeInTheDocument();

    view.rerender(
      <QABot
        apiKey="key"
        isLoggedIn={true}
        qaEndpoint="https://agent.example/api/v1/query"
        embedded
        welcomeMessage="Welcome to the bot"
      />,
    );
    await settle();

    expect(headerLogin()).not.toBeInTheDocument();
    expect(screen.getByLabelText('User logged in')).toBeInTheDocument();
  });

  it('lets the host disable the bot', async () => {
    const { ref } = renderBot();
    await settle();

    act(() => ref.current?.setBotEnabled(false));
    await settle();

    expect(screen.getByText('To ask questions, please log in first.')).toBeInTheDocument();
  });

  it('never fetches a token', async () => {
    renderBot();
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Agent mode ─────────────────────────────────────────────────────────

let tokenUrlCount = 0;

function agentConfig() {
  // A fresh identity site per test: token sources are shared per URL.
  tokenUrlCount += 1;
  return {
    tokenUrl: `https://support${tokenUrlCount}.example/api/agent-token`,
    loginUrl: `https://support${tokenUrlCount}.example/user/login`,
    agentUrl: 'https://agent.example',
  };
}

const minted = (token: string) => ({
  ok: true,
  status: 200,
  headers: new Headers(),
  json: async () => ({ access_token: token, expires_in: 900 }),
}) as unknown as Response;
const loginRequired = () => ({ ok: false, status: 401, headers: new Headers(), json: async () => ({}) }) as unknown as Response;

const mintCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/agent-token'));

function renderAgentBot(props: Partial<React.ComponentProps<typeof QABot>> = {}) {
  const config = agentConfig();
  const view = renderBot({ agentAuth: config, ...props });
  return { ...view, config };
}

describe('agent mode', () => {
  it('does not mint on mount', async () => {
    renderAgentBot();
    await settle();

    expect(mintCalls()).toHaveLength(0);
  });

  it('mints when the embedded chat is first focused', async () => {
    fetchMock.mockResolvedValue(minted('t1'));
    renderAgentBot();
    await settle();

    act(() => {
      document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await settle();

    expect(mintCalls()).toHaveLength(1);
  });

  it('mints when the floating chat opens, not when it closes', async () => {
    fetchMock.mockResolvedValue(minted('t1'));
    renderAgentBot({ embedded: false });
    await settle();
    const toggle = (newState: boolean) =>
      act(() => {
        const event = new Event('rcb-toggle-chat-window') as Event & { data?: unknown };
        event.data = { currState: !newState, newState };
        window.dispatchEvent(event);
      });

    toggle(false);
    await settle();
    expect(mintCalls()).toHaveLength(0);

    toggle(true);
    await settle();
    expect(mintCalls()).toHaveLength(1);
  });

  it('shows neither sign-in nor the user icon before the first mint', async () => {
    renderAgentBot({ isLoggedIn: false });
    await settle();

    expect(headerLogin()).not.toBeInTheDocument();
    expect(document.querySelector('.qa-bot')).not.toHaveClass('bot-logged-in');
  });

  it('ignores the host isLoggedIn', async () => {
    renderAgentBot({ isLoggedIn: false });
    await settle();

    expect(screen.queryByText('To ask questions, please log in first.')).not.toBeInTheDocument();
  });

  it('follows the mint in the header and keeps the conversation', async () => {
    fetchMock.mockResolvedValue(minted('t1'));
    const { ref } = renderAgentBot();
    await settle();
    act(() => ref.current?.addMessage('An earlier answer'));
    await settle();

    act(() => {
      document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await settle();

    expect(document.querySelector('.qa-bot')).toHaveClass('bot-logged-in');
    expect(screen.getByText('An earlier answer')).toBeInTheDocument();
    expect(screen.getAllByText('Welcome to the bot')).toHaveLength(1);
  });

  it('shows sign-in in the header when the user is signed out', async () => {
    fetchMock.mockResolvedValue(loginRequired());
    renderAgentBot();
    await settle();

    act(() => {
      document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await settle();

    expect(headerLogin()).toBeInTheDocument();
    expect(document.querySelector('.qa-bot')).not.toHaveClass('bot-logged-in');
  });

  it('starts a clean conversation and clears history when the user signs out', async () => {
    fetchMock.mockResolvedValueOnce(minted('t1')).mockResolvedValue(loginRequired());
    const { ref, config } = renderAgentBot();
    await settle();
    act(() => {
      document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await settle();
    act(() => ref.current?.addMessage('An earlier answer'));
    await settle();
    localStorage.setItem('qa_bot_session_messages', JSON.stringify({ old: { messages: [], startedAt: '', preview: '' } }));

    const { getAgentTokenSource } = await import('../utils/agent-token');
    await act(async () => {
      await getAgentTokenSource(config.tokenUrl).refresh();
    });
    await settle(300);

    expect(screen.queryByText('An earlier answer')).not.toBeInTheDocument();
    expect(screen.getAllByText('Welcome to the bot')).toHaveLength(1);
    expect(screen.getByText("You've been signed out, so this is a new conversation.")).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('qa_bot_session_messages') ?? '{}');
    expect(stored.old).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('An earlier answer');
  });

  it('behaves as if unset when the config is invalid', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    renderBot({ isLoggedIn: false, agentAuth: { ...agentConfig(), tokenUrl: 'not a url' } });
    await settle();

    expect(headerLogin()).toBeInTheDocument();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('offers sign-in after a failed mint instead of an empty header', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderAgentBot();
    await settle();

    act(() => {
      document.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await settle();

    expect(headerLogin()).toBeInTheDocument();
  });

  it('warns when questions would go to another origin than the agent', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderAgentBot({ qaEndpoint: 'https://rag.example/chat' });
    await settle();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('qaEndpoint'));
    warn.mockRestore();
  });

  it('does not warn when questions go to the agent', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    renderAgentBot({ qaEndpoint: 'https://agent.example/api/v1/query' });
    await settle();

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('qaEndpoint'));
    warn.mockRestore();
  });
});
