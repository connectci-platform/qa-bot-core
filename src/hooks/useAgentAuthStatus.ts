import { useEffect, useState } from 'react';
import type { AgentTokenSource, AuthStatus } from '../utils/agent-token';

/**
 * The token source's sign-in status, re-rendering when it changes. A null
 * source (agent mode off) is always `unknown`. Uses useState and useEffect
 * rather than useSyncExternalStore, which React 16 and 17 lack.
 */
export function useAgentAuthStatus(source: AgentTokenSource | null): AuthStatus {
  const [status, setStatus] = useState<AuthStatus>(() => source?.getStatus() ?? 'unknown');

  useEffect(() => {
    if (!source) {
      setStatus('unknown');
      return undefined;
    }
    setStatus(source.getStatus());
    return source.subscribe(() => setStatus(source.getStatus()));
  }, [source]);

  return status;
}
