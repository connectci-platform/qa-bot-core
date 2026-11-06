import React from 'react';
import { useMessages } from 'react-chatbotify';
import LoginButton from './LoginButton';
import UserIcon from './UserIcon';
import { useAgentAuthStatus } from '../hooks/useAgentAuthStatus';
import { AgentTokenError, type AgentTokenSource } from '../utils/agent-token';
import { openSignIn } from '../utils/sign-in';
import type { AgentAuthConfig } from '../config';

interface AgentAuthButtonProps {
  source: AgentTokenSource;
  config: AgentAuthConfig;
}

/** The sign-in button in agent mode: a popup to the identity site, then a re-mint. */
export function AgentSignInButton({
  source,
  config,
  isHeaderButton = false,
}: AgentAuthButtonProps & { isHeaderButton?: boolean }) {
  const { injectMessage } = useMessages();
  const onError = (error: unknown) => {
    injectMessage(error instanceof AgentTokenError ? error.message : new AgentTokenError('temporary').message);
  };
  return (
    <LoginButton
      loginUrl={config.loginUrl}
      isHeaderButton={isHeaderButton}
      onClick={() => openSignIn(source, config.loginUrl, onError)}
    />
  );
}

/**
 * The header's sign-in slot in agent mode. react-chatbotify reads its
 * settings once, so this one element stays in the header and follows the
 * status itself: nothing until the first mint, then sign-in or the user icon.
 * A refused origin (403) gets nothing, since signing in can't change that.
 */
export function AgentAuthHeaderButton({ source, config }: AgentAuthButtonProps) {
  const status = useAgentAuthStatus(source);
  // A failed mint leaves the status unknown; re-render on it so sign-in is
  // offered (it retries through the popup) rather than an empty header.
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => source.subscribe(rerender), [source]);
  if (status === 'signed_in') return <UserIcon />;
  const failure = source.lastFailure();
  if (status === 'signed_out' || (failure && failure !== 'refused')) {
    return <AgentSignInButton source={source} config={config} isHeaderButton />;
  }
  return null;
}
