// src/utils/flows/qa-flow.tsx
import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getProcessedText } from '../getProcessedText';
import LoginButton from '../../components/LoginButton';
import TurnstileWidget from '../../components/TurnstileWidget';
import PreviewCard from '../../components/PreviewCard';
import { parsePreviews } from '../preview';
import type { Preview } from '../preview';
import { logger, isDebugEnabled } from '../logger';
import { viteEnv } from '../vite-env';
import { agentFetch, isAgentRequest } from '../agent-fetch';
import { AgentTokenError } from '../agent-token';
import type { AgentTokenSource, AuthStatus } from '../agent-token';
import type { Params } from 'react-chatbotify';
import type { AgentAuthConfig } from '../../config';
import type { AnalyticsEventInput } from '../../contexts/AnalyticsContext';

/**
 * What the flow needs in agent mode. QABot owns the token source and the
 * reset; the flow only reads through this.
 */
export interface AgentFlowContext {
  config: AgentAuthConfig;
  source: AgentTokenSource;
  /** The sign-in status, running the first mint if it is still unknown. */
  ensureStatus(): Promise<AuthStatus>;
  /** Start a new conversation: the user signed out, or the agent no longer knows this thread. */
  requestReset(kind: 'signed_out' | 'thread_lost'): void;
  /** The sign-in button for prompts. */
  signInButton(): React.ReactElement;
  /** False after the host called setBotEnabled(false). */
  hostEnabled(): boolean;
  /** Goes up on every reset, so a send can tell its conversation is gone. */
  resetGeneration(): number;
}

/** The part of react-chatbotify's flow params a send writes through. */
interface ChatIO {
  injectMessage: (content: string | React.ReactElement, sender?: string) => Promise<unknown>;
  streamMessage: (content: string | React.ReactElement, sender?: string) => Promise<unknown>;
  endStreamMessage: (sender?: string) => Promise<unknown>;
}

const STILL_ANSWERING = 'Still answering your last question.';
const AGENT_UNAVAILABLE = 'The assistant is temporarily unavailable. Please try again in a few minutes.';
const DEFAULT_SIGN_IN_TEXT = 'Sign in to continue.';

/**
 * Configuration for creating a Q&A flow
 */
export interface CreateQAFlowParams {
  /** Q&A API endpoint (required) */
  endpoint: string;
  /** Rating API endpoint for RAG responses (optional) */
  ratingEndpoint?: string;
  /** Rating API endpoint for agent responses (optional) */
  agentRatingEndpoint?: string;
  /** API key for authentication (optional) */
  apiKey?: string;
  /** Function that returns current session ID */
  sessionId: () => string | null;
  /** Function that returns whether we're currently resetting */
  isResetting?: () => boolean;
  /** Whether the user is logged in. `undefined` means "open access mode" —
   *  treated as logged-in for gating purposes. */
  isLoggedIn?: boolean;
  /** Allow Q&A without login (default: false) */
  allowAnonAccess?: boolean;
  /** Login URL to redirect to (optional) */
  loginUrl?: string;
  /**
   * The acting user's identifier.
   * @deprecated Identity is now determined server-side from the JWT cookie.
   * This prop is ignored — retained only for backward compatibility during transition.
   */
  actingUser?: string;
  /** Enriched analytics tracker (adds common fields automatically) */
  trackEvent?: (event: AnalyticsEventInput) => void;
  /**
   * Returns the current silent Turnstile token (from useTurnstile hook).
   * When available, attached to every request so the backend can verify
   * without prompting.  When null, the backend's free-query allowance
   * applies, and the visible challenge is the fallback.
   */
  getTurnstileToken?: () => string | null;
  /** Reset the Turnstile widget to generate a fresh token after each use. */
  resetTurnstileToken?: () => void;
  /** Backend ID — included as _backend in request body for proxy routing. */
  backendId?: string;
  /** RP slug for resource-scoped queries (e.g. 'delta'). */
  resourceContext?: string;
  /** Agent mode: Bearer tokens instead of cookies. Unset keeps today's behavior. */
  agent?: AgentFlowContext;
}

/**
 * Builds a plain text string for displaying response metadata.
 * Returns empty string if no metadata is present.
 */
function buildMetadataText(body: {
  confidence?: string;
  tools_used?: string[];
  metadata?: Record<string, unknown>;
}): string {
  const { confidence, tools_used, metadata } = body;

  // Skip if no metadata present
  if (!confidence && (!tools_used || tools_used.length === 0)) {
    return '';
  }

  const parts: string[] = [];

  if (confidence) {
    parts.push(`• Confidence: ${confidence}`);
  }

  if (tools_used && tools_used.length > 0) {
    parts.push(`• Tools used: ${tools_used.join(', ')}`);
  }

  // Show agent name from metadata (useful for demo/debugging)
  if (metadata?.agent) {
    parts.push(`• Agent: ${metadata.agent}`);
  }

  return `---\n${parts.join('\n')}`;
}

/**
 * Wrapper that reads the Turnstile site key from mutable state at render time.
 * The flow's component JSX is captured once at definition, but the site key
 * isn't known until the API returns requires_turnstile. This wrapper bridges
 * that gap by accepting a getter function.
 */
interface TurnstileState {
  siteKey: string | null;
  token: string | null;
  pendingQuery: any;
  needsChallenge: boolean;
  /** Counts challenges, so a repeat challenge with the same site key is still new. */
  challenge: number;
}

type ResubmitResult = 'success' | 'needs_another_challenge' | 'error' | 'busy';

interface TurnstileWidgetWrapperProps {
  getState: () => TurnstileState;
  onResubmit: (token: string) => Promise<ResubmitResult>;
  trackEvent?: (event: AnalyticsEventInput) => void;
  loginUrl: string;
  /** Re-render when the flow changes the challenge state outside the widget. */
  subscribe?: (listener: () => void) => () => void;
}

function TurnstileWidgetWrapper({ getState, onResubmit, trackEvent, loginUrl, subscribe }: TurnstileWidgetWrapperProps) {
  // Track which siteKey we've already resolved against. When a NEW challenge
  // is requested (siteKey changes), we want the widget to reappear — we
  // can't use a plain `resolved` boolean because it would permanently
  // suppress future challenges for the same wrapper instance.
  const [resolvedFor, setResolvedFor] = React.useState<string | null>(null);
  // Incremented to force re-mount of TurnstileWidget when a re-challenge is needed
  const [challengeKey, setChallengeKey] = React.useState(0);
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => subscribe?.(rerender), [subscribe]);
  const state = getState();

  // Dev-only force-render for widget styling work: VITE_FORCE_TURNSTILE_WIDGET=true
  // keeps the modal mounted regardless of proxy state. Defaults off. See README.
  const env = viteEnv();
  const forceRender = env.VITE_FORCE_TURNSTILE_WIDGET === 'true';
  const effectiveSiteKey = state.siteKey ?? (forceRender ? env.VITE_TURNSTILE_SITE_KEY : null);

  if (!effectiveSiteKey) return null;
  // Agent mode (the only caller that subscribes) tells repeat challenges
  // apart by count, since the site key doesn't change between them.
  const challengeId = subscribe ? `${effectiveSiteKey}#${state.challenge}` : effectiveSiteKey;
  if (!forceRender && resolvedFor === challengeId) return null;

  return (
    <TurnstileWidget
      key={subscribe ? `${challengeKey}-${state.challenge}` : challengeKey}
      siteKey={effectiveSiteKey}
      loginUrl={loginUrl}
      onVerify={async (token) => {
        // Capture the siteKey BEFORE awaiting onResubmit. The resubmit clears
        // state.siteKey on success, so reading it afterward gives null, and
        // setResolvedFor(null) is a no-op when resolvedFor is already null —
        // the modal would never unmount on a first successful challenge.
        const challengeSiteKey = challengeId;
        state.token = token;
        trackEvent?.({ type: 'chatbot_turnstile_completed' });
        const result = await onResubmit(token);
        if (result === 'busy') {
          // A sign-in is already sending the question; its outcome decides
          // whether this widget is needed again.
          return;
        }
        if (result === 'needs_another_challenge') {
          // Proxy asked for another challenge — re-mount widget with new siteKey
          setChallengeKey(k => k + 1);
        } else {
          // 'success' or 'error' — this challenge is done. Mark it resolved
          // against the siteKey we challenged for so the wrapper bails out
          // on the next render. state.siteKey has been cleared inside
          // onResubmit, so the !effectiveSiteKey guard also returns null.
          setResolvedFor(challengeSiteKey);
        }
      }}
      onError={(reason, errorCode) => {
        // Widget-level failure or user cancellation — clear flow state so
        // the chat returns to a clean idle, then mark the challenge resolved.
        // Capture queryId before clearing pendingQuery.
        const queryId = state.pendingQuery?.queryId;
        const challengeSiteKey = challengeId;
        state.token = null;
        state.pendingQuery = null;
        state.needsChallenge = false;
        state.siteKey = null;
        setResolvedFor(challengeSiteKey);
        trackEvent?.({
          type: 'chatbot_turnstile_error',
          queryId,
          failureReason: reason,
          cloudflareErrorCode: errorCode,
        });
      }}
    />
  );
}

/**
 * Creates the basic Q&A conversation flow
 * Handles questions, responses, and optional ratings
 */
export const createQAFlow = ({
  endpoint,
  ratingEndpoint,
  agentRatingEndpoint,
  apiKey,
  sessionId: getSessionId,
  isResetting = () => false,
  isLoggedIn,
  allowAnonAccess = false,
  loginUrl = '/login',
  actingUser,
  trackEvent,
  getTurnstileToken,
  resetTurnstileToken,
  backendId,
  resourceContext,
  agent,
}: CreateQAFlowParams) => {
  // Gate Q&A when user is logged out (unless allowAnonAccess is true).
  // Agent mode gates on each send instead, so signing in never swaps flows.
  if (!agent && isLoggedIn === false && !allowAnonAccess) {
    // Track that login prompt was shown
    trackEvent?.({ type: 'chatbot_login_prompt_shown' });

    return {
      qa_loop: {
        message: "To ask questions, please log in first.",
        component: <LoginButton loginUrl={loginUrl} />,
        chatDisabled: true,
        path: "qa_loop"
      }
    };
  }

  // Track query ID for feedback
  let feedbackQueryId: string | null = null;
  // Track response metadata for rating routing
  let lastRatingTarget: string | null = null;
  let lastIsFinalResponse = false;

  // Turnstile state — shared between qa_loop and turnstile_challenge steps.
  // Uses a mutable object so the TurnstileWidget component can read the
  // current siteKey at render time (not the value captured at flow creation).
  const turnstileState = {
    siteKey: null as string | null,
    token: null as string | null,
    pendingQuery: null as {
      query: string;
      sessionId: string | null;
      queryId: string;
      confirmIds?: string[];
    } | null,
    needsChallenge: false,
    challenge: 0,
  };

  // Mutable ref to injectMessage — captured from chatState on each message call
  // so the Turnstile onVerify callback can inject responses into the chat.
  let injectMessage: ((msg: string | React.ReactElement) => Promise<unknown>) | null = null;
  // The latest chat params, so a preview card's buttons can send a turn.
  let lastChat: Pick<Params, 'injectMessage' | 'goToPath'> | null = null;
  // The card click being sent, read once by the qa_loop step it starts.
  let cardSend: { text: string; confirmIds: string[] } | null = null;

  // A preview card stays usable through typed replies, which can't confirm
  // it, until the user clicks Confirm or Cancel (or types cancel) or a newer
  // card replaces it. Its buttons wait while a reply is coming in.
  let latestCard = 0;
  let answeredCard = 0;
  let sending = false;
  const turnListeners = new Set<() => void>();
  const subscribeTurn = (listener: () => void) => {
    turnListeners.add(listener);
    return () => {
      turnListeners.delete(listener);
    };
  };
  const notifyCards = () => turnListeners.forEach((listener) => listener());
  const isCancel = (text: string) => text.trim().toLowerCase().replace(/[.!]+$/, '') === 'cancel';

  // Agent requests carry the token; everything else is today's fetch.
  const request = (url: string, init: RequestInit) =>
    agent ? agentFetch(agent.source, agent.config, url, init) : fetch(url, init);

  // Tells the Turnstile widget to re-read state the flow changed itself.
  const turnstileListeners = new Set<() => void>();
  const subscribeTurnstile = (listener: () => void) => {
    turnstileListeners.add(listener);
    return () => {
      turnstileListeners.delete(listener);
    };
  };
  const notifyTurnstile = () => {
    if (agent) turnstileListeners.forEach((listener) => listener());
  };

  // A prompt that is never saved to history, since its button can't be restored.
  // react-chatbotify only draws the bubble for string messages, so a
  // component message draws its own, matching the bot's (rcb-bot-message
  // plus the colors react-chatbotify sets inline on string messages).
  const transient = (text: string, withSignIn: boolean) => (
    <div data-transient className="rcb-bot-message-container">
      <div>
        <div
          className="rcb-bot-message"
          style={{ backgroundColor: 'var(--secondaryColor, #107180)', color: '#fff', maxWidth: '70%' }}
        >
          {text}
        </div>
        {withSignIn && agent?.signInButton()}
      </div>
    </div>
  );

  // The agent's call-time gate refused a tool. write_scope means this page
  // can't make changes even signed in, so it gets no sign-in button.
  const refusalMessage = (reason: string) =>
    reason === 'write_scope'
      ? transient("Changes aren't available here.", false)
      : transient(agent?.config.signInText || DEFAULT_SIGN_IN_TEXT, true);

  // Agent statuses that answer before any run starts. Returns the reply, or
  // null when the response should be read as usual. Only the agent's own
  // responses count: a proxy or a wrong path can 404 too.
  const agentStatusReply = async (url: string, res: Response): Promise<string | undefined | null> => {
    if (!agent || res.ok || !isAgentRequest(agent.config, url)) return null;
    if (res.status === 404) {
      // The agent's answer when the thread belongs to another identity.
      const body = await res.json().catch(() => null);
      if (body?.detail !== 'Thread not found') return null;
      agent.requestReset('thread_lost');
      return undefined;
    }
    if (res.status === 409) return STILL_ANSWERING;
    if (res.status === 503) return AGENT_UNAVAILABLE;
    return null;
  };

  // The one sign-in watch for a pending Turnstile challenge. Each new
  // challenge replaces it, so a sign-in resends at most once.
  let signInWatch: (() => void) | null = null;
  const dropSignInWatch = () => {
    signInWatch?.();
    signInWatch = null;
  };
  const clearTurnstile = () => {
    turnstileState.token = null;
    turnstileState.pendingQuery = null;
    turnstileState.needsChallenge = false;
    turnstileState.siteKey = null;
    notifyTurnstile();
  };
  const watchForSignIn = () => {
    if (!agent) return;
    dropSignInWatch();
    signInWatch = agent.source.subscribe(() => {
      if (agent.source.getStatus() !== 'signed_in') return;
      dropSignInWatch();
      if (!turnstileState.needsChallenge || !turnstileState.pendingQuery) return;
      if (turnstileState.pendingQuery.sessionId !== getSessionId()) {
        // The conversation was reset; its question belongs to no one now.
        clearTurnstile();
        return;
      }
      void handleTurnstileResubmit(null);
    });
  };

  // One resubmit at a time: the widget and a sign-in can both try to send
  // the pending question.
  let resubmitting = false;

  // Auto-resubmit after visible Turnstile challenge completes.
  // Called from TurnstileWidgetWrapper's onVerify — fetches the pending query
  // with the new token and injects the response directly into the chat.
  // Returns: 'success' | 'needs_another_challenge' | 'error'
  // A null token means the user signed in while challenged: the agent skips
  // Turnstile for signed-in callers, so the question goes without one.
  const handleTurnstileResubmit = async (token: string | null): Promise<ResubmitResult> => {
    if (agent && resubmitting) return 'busy';
    resubmitting = true;
    let result: ResubmitResult;
    try {
      result = await resubmitPending(token);
    } finally {
      resubmitting = false;
    }
    if (agent && result === 'needs_another_challenge') {
      // A widget resend that went out before the user signed in: send again
      // with the token, which the agent doesn't challenge.
      if (token !== null && agent.source.getStatus() === 'signed_in') {
        return handleTurnstileResubmit(null);
      }
      watchForSignIn();
    } else if (result !== 'needs_another_challenge') {
      dropSignInWatch();
    }
    return result;
  };

  const resubmitPending = async (token: string | null): Promise<'success' | 'needs_another_challenge' | 'error'> => {
    if (!turnstileState.pendingQuery || !injectMessage) {
      logger.error('Turnstile resubmit called without pending query or injectMessage');
      return 'error';
    }

    // In agent mode a reset can start a new conversation while this runs;
    // its question and answer belong to the old one.
    const forSession = turnstileState.pendingQuery.sessionId;
    const stale = () => agent !== undefined && forSession !== getSessionId();
    const inject = injectMessage;
    const show = async (message: string | React.ReactElement) => {
      if (!stale()) await inject(message);
    };
    if (stale()) {
      clearTurnstile();
      return 'error';
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-API-KEY'] = apiKey;
      if (turnstileState.pendingQuery.sessionId) {
        headers['X-Session-ID'] = turnstileState.pendingQuery.sessionId;
        headers['X-Query-ID'] = turnstileState.pendingQuery.queryId;
      }
      headers['X-Origin'] = resourceContext || 'access';

      const retryBody: Record<string, unknown> = {
        query: turnstileState.pendingQuery.query,
        question_id: turnstileState.pendingQuery.queryId,
      };
      if (turnstileState.pendingQuery.confirmIds) {
        retryBody.confirm_ids = turnstileState.pendingQuery.confirmIds;
      }
      if (token !== null) {
        retryBody.turnstile_token = token;
      }
      if (turnstileState.pendingQuery.sessionId) {
        retryBody.session_id = turnstileState.pendingQuery.sessionId;
      }
      if (backendId) {
        retryBody._backend = backendId;
      }
      if (resourceContext) {
        // rp_name is the legacy field name used by qa-bot-proxy.
        // resource_context is the canonical field name on the agent's
        // /api/v1/query endpoint. Send both during the transition so the
        // same client works against either backend without negotiation.
        retryBody.rp_name = resourceContext;
        retryBody.resource_context = resourceContext;
      }

      const retryResponse = await request(endpoint, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(retryBody),
      });

      const savedQueryId = turnstileState.pendingQuery.queryId;

      const statusReply = await agentStatusReply(endpoint, retryResponse);
      if (statusReply !== null) {
        clearTurnstile();
        if (statusReply) await show(statusReply);
        return 'error';
      }

      if (!retryResponse.ok) {
        throw new Error(`API returned ${retryResponse.status} after Turnstile`);
      }

      const retryContentType = retryResponse.headers.get('content-type') || '';

      if (retryContentType.includes('text/event-stream')) {
        // SSE response — consume the full stream and inject final result
        const reader = retryResponse.body?.getReader();
        if (!reader) throw new Error('Response body is not readable');

        const decoder = new TextDecoder();
        let sseBuffer = '';
        let collectedTokens = '';
        let doneMetadata: Record<string, unknown> = {};
        let refusal: string | null = null;
        let previews: Preview[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });

          let boundary = sseBuffer.indexOf('\n\n');
          while (boundary !== -1) {
            const block = sseBuffer.slice(0, boundary);
            sseBuffer = sseBuffer.slice(boundary + 2);

            let evType = '', evData = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) evType = line.slice(7);
              else if (line.startsWith('data: ')) evData = line.slice(6);
            }

            if (evType && evData) {
              try {
                const parsed = JSON.parse(evData);
                if (evType === 'token') collectedTokens += (parsed.content || '');
                else if (evType === 'done') {
                  doneMetadata = (parsed.metadata as Record<string, unknown>) || {};
                  previews = parsePreviews(parsed.previews);
                }
                else if (evType === 'requires_auth' && agent) refusal = (parsed.reason as string) || null;
              } catch { /* skip malformed */ }
            }
            boundary = sseBuffer.indexOf('\n\n');
          }
        }

        // Clear Turnstile state
        turnstileState.token = null;
        turnstileState.pendingQuery = null;
        turnstileState.needsChallenge = false;
        turnstileState.siteKey = null;

        if (!collectedTokens && !refusal) throw new Error('No content received from stream');

        lastRatingTarget = (doneMetadata.rating_target as string) || null;
        lastIsFinalResponse = doneMetadata.is_final_response === true;
        feedbackQueryId = savedQueryId;

        if (collectedTokens) await show(getProcessedText(collectedTokens));
        notifyTurnstile();
        if (refusal) await show(refusalMessage(refusal));
        if (previews.length > 0) await show(previewCard(previews));

        trackEvent?.({
          type: 'chatbot_answer_received',
          queryId: savedQueryId,
          success: true,
          responseLength: collectedTokens.length,
        });
        return 'success';
      }

      // JSON response path (discovery, repeated Turnstile challenge)
      const body = await retryResponse.json();

      // If challenged again, keep pendingQuery intact so the user can re-solve
      if (body.requires_turnstile) {
        turnstileState.siteKey = body.site_key;
        turnstileState.token = null;
        turnstileState.challenge += 1;
        notifyTurnstile();
        await show("Still verifying — please complete the challenge again.");
        return 'needs_another_challenge';
      }

      // Clear Turnstile state — challenge is resolved
      turnstileState.token = null;
      turnstileState.pendingQuery = null;
      turnstileState.needsChallenge = false;
      turnstileState.siteKey = null;

      const text = body.response || body.answer || body.text || body.message;
      if (!text) throw new Error('Invalid response format from API');

      const retryMetadata = body.metadata || {};
      lastRatingTarget = retryMetadata.rating_target || null;
      lastIsFinalResponse = retryMetadata.is_final_response === true;
      feedbackQueryId = savedQueryId;

      const processedText = getProcessedText(text);
      const metadataText = isDebugEnabled() ? buildMetadataText(body) : '';
      const fullContent = metadataText ? `${processedText}\n\n${metadataText}` : processedText;

      await show(fullContent);
      notifyTurnstile();

      trackEvent?.({
        type: 'chatbot_answer_received',
        queryId: savedQueryId,
        success: true,
        responseLength: text.length,
      });
      return 'success';
    } catch (error) {
      logger.error('Error resubmitting after Turnstile:', error);
      turnstileState.token = null;
      turnstileState.pendingQuery = null;
      turnstileState.needsChallenge = false;
      turnstileState.siteKey = null;
      await show("I had trouble processing your question after verification. Please try again.");
      return 'error';
    }
  };

  // Sends one question and shows its answer. A typed question and a
  // preview card's Confirm or Cancel both come through here, so they share
  // the session, token, headers and Turnstile handling. Returns a message
  // for the caller to show, like the flow's message function.
  const ask = async (chatState: ChatIO, userInput: string, confirmIds?: string[]): Promise<string | void> => {
    sending = true;
    if (confirmIds?.length || isCancel(userInput)) answeredCard = latestCard;
    notifyCards();
    try {
      return await send(chatState, userInput, confirmIds);
    } finally {
      sending = false;
      notifyCards();
    }
  };

  const send = async (chatState: ChatIO, userInput: string, confirmIds?: string[]): Promise<string | void> => {
    // A reset during this send means its conversation is gone; stop
    // writing into the new one.
    const generation = agent?.resetGeneration();
    const abandoned = () => agent !== undefined && agent.resetGeneration() !== generation;
    try {
      if (agent) {
        if (!agent.hostEnabled()) {
          return 'To ask questions, please log in first.';
        }
        // Wait for the first mint, so a send never goes out before the
        // bot knows whether the user is signed in.
        const status = await agent.ensureStatus();
        if (!allowAnonAccess && status === 'signed_out') {
          trackEvent?.({ type: 'chatbot_login_prompt_shown' });
          await chatState.injectMessage(transient('To ask questions, please sign in first.', true));
          return;
        }
        if (!allowAnonAccess && status !== 'signed_in') {
          return new AgentTokenError(agent.source.lastFailure() ?? 'temporary').message;
        }
        if (status === 'signed_in' && !(await agent.source.getToken())) {
          // Signed out elsewhere: the agent would refuse this thread to
          // an anonymous caller, so start over instead of sending.
          agent.requestReset('signed_out');
          return;
        }
      }

      const queryId = uuidv4();
      feedbackQueryId = queryId;

      // Track question asked
      trackEvent?.({
        type: 'chatbot_question_sent',
        queryId,
        questionLength: userInput.length
      });

      const headers = {
        'Content-Type': 'application/json'
      };

      // Add optional headers
      if (apiKey) {
        headers['X-API-KEY'] = apiKey;
      }
      const currentSessionId = getSessionId();
      if (currentSessionId) {
        headers['X-Session-ID'] = currentSessionId;
        headers['X-Query-ID'] = queryId;
      }
      headers['X-Origin'] = resourceContext || 'access';
      // Build request body — include silent Turnstile token when available
      const requestBody: Record<string, unknown> = {
        query: userInput,
        question_id: queryId
      };
      if (confirmIds) {
        requestBody.confirm_ids = confirmIds;
      }
      if (currentSessionId) {
        requestBody.session_id = currentSessionId;
      }
      if (backendId) {
        requestBody._backend = backendId;
      }
      if (resourceContext) {
        // rp_name is the legacy field name used by qa-bot-proxy.
        // resource_context is the canonical field name on the agent's
        // /api/v1/query endpoint. Send both during the transition so the
        // same client works against either backend without negotiation.
        requestBody.rp_name = resourceContext;
        requestBody.resource_context = resourceContext;
      }
      const silentToken = getTurnstileToken?.();
      if (silentToken) {
        requestBody.turnstile_token = silentToken;
      }

      // Log the session ID being sent
      logger.session('SENT to API', {
        session_id: currentSessionId,
        question_id: queryId
      });

      // Capture timestamp before fetch for response time calculation
      const requestStartTime = Date.now();

      if (abandoned()) {
        // A reset (say, a sign-out seen while minting) already started a
        // new conversation; this question belonged to the old one.
        return;
      }

      const response = await request(endpoint, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(requestBody)
      });

      const statusReply = await agentStatusReply(endpoint, response);
      if (statusReply !== null) {
        return statusReply;
      }

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || '';

      // ── SSE streaming path (agent queries) ──────────────────────
      if (contentType.includes('text/event-stream')) {
        // Token was accepted — reset widget for a fresh token on the next request.
        resetTurnstileToken?.();
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Response body is not readable');

        const decoder = new TextDecoder();
        let buffer = '';
        let tokenContent = '';  // Accumulated LLM tokens
        let streamStarted = false;
        let refusal: string | null = null;
        let previews: Preview[] = [];

        try {
          while (!abandoned()) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events from buffer (events are separated by double newlines)
            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1 && !abandoned()) {
              const eventBlock = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);

              // Parse event type and data from the block
              let eventType = '';
              let eventData = '';
              for (const line of eventBlock.split('\n')) {
                if (line.startsWith('event: ')) {
                  eventType = line.slice(7);
                } else if (line.startsWith('data: ')) {
                  eventData = line.slice(6);
                }
              }

              if (!eventType || !eventData) {
                boundary = buffer.indexOf('\n\n');
                continue;
              }

              let parsed: Record<string, unknown>;
              try {
                parsed = JSON.parse(eventData);
              } catch {
                logger.warn('Failed to parse SSE data:', eventData);
                boundary = buffer.indexOf('\n\n');
                continue;
              }

              if (eventType === 'status') {
                // Status updates replace each other in the stream bubble
                const statusMsg = (parsed.message as string) || 'Processing...';
                await chatState.streamMessage(`_${statusMsg}_`, 'BOT');
                streamStarted = true;
              } else if (eventType === 'token') {
                // LLM tokens — accumulate and replace stream content
                const chunk = (parsed.content as string) || '';
                tokenContent += chunk;
                const processedSoFar = getProcessedText(tokenContent);
                await chatState.streamMessage(processedSoFar, 'BOT');
              } else if (eventType === 'done') {
                // Stream complete — finalize with metadata
                const doneMetadata = (parsed.metadata as Record<string, unknown>) || {};
                previews = parsePreviews(parsed.previews);
                lastRatingTarget = (doneMetadata.rating_target as string) || null;
                lastIsFinalResponse = doneMetadata.is_final_response === true;

                if (tokenContent) {
                  // Tokens were streamed — content is already displayed.
                  // Just finalize the stream.
                  await chatState.endStreamMessage('BOT');
                } else {
                  // No tokens (RAG-direct, domain agent) — display the
                  // full response from the done event.
                  const finalText = (parsed.response as string) || '';
                  if (finalText) {
                    const processedText = getProcessedText(finalText);
                    await chatState.streamMessage(processedText, 'BOT');
                    streamStarted = true;
                  }
                  if (streamStarted) {
                    await chatState.endStreamMessage('BOT');
                  }
                }
              } else if (eventType === 'requires_auth' && agent) {
                // Sent just before done; explained once the reply is shown.
                refusal = (parsed.reason as string) || null;
              } else if (eventType === 'error') {
                const errorMsg = (parsed.message as string) || 'An error occurred';
                logger.error('SSE error event:', errorMsg);
                if (streamStarted) {
                  await chatState.streamMessage(errorMsg, 'BOT');
                  await chatState.endStreamMessage('BOT');
                } else {
                  await chatState.injectMessage(errorMsg);
                }
              }

              boundary = buffer.indexOf('\n\n');
            }
          }

          // If stream ended without a done event, finalize anyway
          if (streamStarted && !abandoned()) {
            // endStreamMessage is idempotent if already called
            await chatState.endStreamMessage('BOT');
          }
        } catch (streamError) {
          logger.error('Error reading SSE stream:', streamError);
          if (streamStarted) {
            await chatState.streamMessage("I had trouble completing the response. Please try again.", 'BOT');
            await chatState.endStreamMessage('BOT');
          } else {
            throw streamError;
          }
        }

        if (abandoned()) {
          reader.cancel().catch(() => {});
          return;
        }

        if (refusal) {
          await chatState.injectMessage(refusalMessage(refusal));
        }
        if (previews.length > 0) {
          await chatState.injectMessage(previewCard(previews));
        }

        const responseTimeMs = Date.now() - requestStartTime;
        trackEvent?.({
          type: 'chatbot_answer_received',
          queryId,
          responseTimeMs,
          success: true,
          responseLength: tokenContent.length,
        });

        return;
      }

      // ── JSON path (discovery, Turnstile, fallback) ─────────────
      const responseTimeMs = Date.now() - requestStartTime;
      const body = await response.json();

      // Turnstile challenge — store state and let path redirect to the challenge step
      if (body.requires_turnstile) {
        trackEvent?.({ type: 'chatbot_turnstile_shown', queryId });
        turnstileState.siteKey = body.site_key;
        turnstileState.challenge += 1;
        turnstileState.pendingQuery = { query: userInput, sessionId: currentSessionId, queryId, confirmIds };
        turnstileState.needsChallenge = true;
        // Signing in makes the challenge moot: the question goes with
        // the token instead.
        watchForSignIn();
        return "One moment — verifying your session…";
      }

      // Token was accepted (not a Turnstile challenge) — reset for next request.
      resetTurnstileToken?.();

      // Support different response formats
      const text = body.response || body.answer || body.text || body.message;

      if (!text) {
        throw new Error('Invalid response format from API');
      }

      // Capture response metadata for rating routing
      const metadata = body.metadata || {};
      lastRatingTarget = metadata.rating_target || null;
      lastIsFinalResponse = metadata.is_final_response === true;

      // Process text (handles markdown, links, etc.)
      const processedText = getProcessedText(text);

      // Build metadata text (only shown when QA_BOT_DEBUG is enabled)
      const metadataText = isDebugEnabled() ? buildMetadataText(body) : '';
      const fullContent = metadataText ? `${processedText}\n\n${metadataText}` : processedText;

      // Inject the response
      await chatState.injectMessage(fullContent);

      // Track response received
      trackEvent?.({
        type: 'chatbot_answer_received',
        queryId,
        responseTimeMs,
        success: true,
        responseLength: text.length,
        hasMetadata: !!metadataText
      });

      return;
    } catch (error) {
      if (error instanceof AgentTokenError) {
        // The mint failed for a user who needs a token; nothing was sent.
        return error.message;
      }
      logger.error('Error in Q&A flow:', error);

      // Track error event
      trackEvent?.({
        type: 'chatbot_answer_error',
        queryId: feedbackQueryId ?? undefined,
        errorType: error instanceof Error ? error.message : 'unknown'
      });

      return "I apologize, but I'm having trouble processing your question. Please try again later.";
    }
  };

  // A preview card's Confirm or Cancel, sent as the user's next turn. The
  // click is shown as the user's message, which react-chatbotify reads as
  // the step's userInput, and goToPath runs the qa_loop step as a typed
  // question would: typing indicator, answer, rating options, Turnstile.
  const sendFromCard = async (text: string, confirmIds: string[]) => {
    const chat = lastChat;
    if (!chat || isResetting()) return;
    cardSend = { text, confirmIds };
    try {
      await chat.injectMessage(text, 'USER');
      await chat.goToPath('qa_loop');
    } catch (error) {
      logger.error('Error sending from the preview card:', error);
    } finally {
      // The step consumes it; never let it reach a later typed "Confirm".
      cardSend = null;
    }
  };

  // Not saved to history: its buttons can't be restored.
  const previewCard = (previews: Preview[]) => {
    latestCard += 1;
    const card = latestCard;
    notifyCards();
    return (
      <div data-transient data-preview-card className="rcb-bot-message-container qa-bot-preview-card-container">
        <PreviewCard
          previews={previews}
          onSend={sendFromCard}
          isStale={() => sending || card !== latestCard || answeredCard >= card}
          subscribe={subscribeTurn}
        />
      </div>
    );
  };

  // Require endpoint to be configured
  if (!endpoint) {
    throw new Error('Q&A endpoint is required');
  }

  return {
    qa_loop: {
      message: async (chatState) => {
        // Capture injectMessage so the Turnstile auto-resubmit callback can use it
        injectMessage = chatState.injectMessage.bind(chatState);
        lastChat = {
          injectMessage: (...args) => chatState.injectMessage(...args),
          goToPath: (path) => chatState.goToPath(path),
        };

        const { userInput } = chatState;
        if (isResetting && isResetting()) {
          return;
        }

        // Skip processing if there's no user input.
        if (!userInput || userInput.trim() === '') {
          return;
        }

        // Handle feedback — rates the latest answer (feedbackQueryId), routed
        // by its rating_target. Past thumbs are disabled in CSS so they can't
        // submit feedback against the wrong (current) answer.
        if (userInput === "👍 Helpful" || userInput === "👎 Not helpful") {
          if (feedbackQueryId) {
            const isPositive = userInput === "👍 Helpful";
            const targetEndpoint = lastRatingTarget === 'agent' ? agentRatingEndpoint : ratingEndpoint;

            if (targetEndpoint) {
              try {
                const headers: Record<string, string> = {
                  'Content-Type': 'application/json'
                };

                if (apiKey) {
                  headers['X-API-KEY'] = apiKey;
                }

                const currentSessionId = getSessionId();
                if (currentSessionId) {
                  headers['X-Session-ID'] = currentSessionId;
                  headers['X-Query-ID'] = feedbackQueryId;
                }

                // Agent endpoint uses different payload shape
                const body = lastRatingTarget === 'agent'
                  ? {
                      query_id: feedbackQueryId,
                      rating: isPositive ? 'helpful' : 'not_helpful',
                      session_id: currentSessionId,
                    }
                  : {
                      sessionId: currentSessionId,
                      queryId: feedbackQueryId,
                      rating: isPositive ? 1 : 0,
                    };

                await request(targetEndpoint, {
                  method: 'POST',
                  headers,
                  credentials: 'include',
                  body: JSON.stringify(body)
                });

                trackEvent?.({
                  type: 'chatbot_rating_sent',
                  queryId: feedbackQueryId,
                  rating: isPositive ? 'helpful' : 'not_helpful'
                });
              } catch (error) {
                logger.error('Error sending feedback:', error);
              }
            }
          }

          return "Thanks for the feedback!";
        }

        // A preview card's click carries its ids; a typed "Confirm" has none.
        const fromCard = cardSend?.text === userInput ? cardSend : null;
        cardSend = null;
        const confirmIds = fromCard && fromCard.confirmIds.length > 0 ? fromCard.confirmIds : undefined;
        return ask(chatState, userInput, confirmIds);
      },

      // Show rating options only after final responses that have a valid rating target.
      // Thumbs rate the latest answer (via feedbackQueryId); past thumbs are made
      // non-interactive in CSS so an older one can't mis-rate the current answer.
      options: (chatState) => {
        // Don't show options if we're resetting
        if (isResetting && isResetting()) {
          return [];
        }

        // Don't show options after feedback
        if (chatState.userInput === "👍 Helpful" || chatState.userInput === "👎 Not helpful") {
          return [];
        }

        // Don't show options during Turnstile challenge
        if (turnstileState.needsChallenge) {
          return [];
        }

        // Only show rating buttons when:
        // 1. The response was marked as final (is_final_response: true)
        // 2. rating_target is set (not null)
        // 3. A rating endpoint exists for the response's rating_target
        if (!lastIsFinalResponse || !lastRatingTarget) {
          return [];
        }

        const hasEndpoint = lastRatingTarget === 'agent'
          ? !!agentRatingEndpoint
          : !!ratingEndpoint;

        return hasEndpoint ? ["👍 Helpful", "👎 Not helpful"] : [];
      },

      renderMarkdown: ["BOT"],
      chatDisabled: false,
      component: (
        <TurnstileWidgetWrapper
          getState={() => turnstileState}
          onResubmit={handleTurnstileResubmit}
          subscribe={agent ? subscribeTurnstile : undefined}
          trackEvent={trackEvent}
          loginUrl={loginUrl}
        />
      ),
      path: "qa_loop"
    }
  };
};
