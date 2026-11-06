import '@testing-library/jest-dom';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import QABot from './QABot';
import type { BotControllerHandle } from '../config';

jest.mock('../config', () => require('../test-utils/config-without-stream').default());

const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
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
