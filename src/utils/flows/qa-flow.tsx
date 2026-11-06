// src/utils/flows/qa-flow.tsx
import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getProcessedText } from '../getProcessedText';
import LoginButton from '../../components/LoginButton';
import TurnstileWidget from '../../components/TurnstileWidget';
import { logger, isDebugEnabled } from '../logger';
import { viteEnv } from '../vite-env';
import type { AnalyticsEventInput } from '../../contexts/AnalyticsContext';

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
}

interface TurnstileWidgetWrapperProps {
  getState: () => TurnstileState;
  onResubmit: (token: string) => Promise<'success' | 'needs_another_challenge' | 'error'>;
  trackEvent?: (event: AnalyticsEventInput) => void;
  loginUrl: string;
}

function TurnstileWidgetWrapper({ getState, onResubmit, trackEvent, loginUrl }: TurnstileWidgetWrapperProps) {
  // Track which siteKey we've already resolved against. When a NEW challenge
  // is requested (siteKey changes), we want the widget to reappear — we
  // can't use a plain `resolved` boolean because it would permanently
  // suppress future challenges for the same wrapper instance.
  const [resolvedFor, setResolvedFor] = React.useState<string | null>(null);
  // Incremented to force re-mount of TurnstileWidget when a re-challenge is needed
  const [challengeKey, setChallengeKey] = React.useState(0);
  const state = getState();

  // Dev-only force-render for widget styling work: VITE_FORCE_TURNSTILE_WIDGET=true
  // keeps the modal mounted regardless of proxy state. Defaults off. See README.
  const env = viteEnv();
  const forceRender = env.VITE_FORCE_TURNSTILE_WIDGET === 'true';
  const effectiveSiteKey = state.siteKey ?? (forceRender ? env.VITE_TURNSTILE_SITE_KEY : null);

  if (!effectiveSiteKey) return null;
  if (!forceRender && resolvedFor === effectiveSiteKey) return null;

  return (
    <TurnstileWidget
      key={challengeKey}
      siteKey={effectiveSiteKey}
      loginUrl={loginUrl}
      onVerify={async (token) => {
        // Capture the siteKey BEFORE awaiting onResubmit. The resubmit clears
        // state.siteKey on success, so reading it afterward gives null, and
        // setResolvedFor(null) is a no-op when resolvedFor is already null —
        // the modal would never unmount on a first successful challenge.
        const challengeSiteKey = effectiveSiteKey;
        state.token = token;
        trackEvent?.({ type: 'chatbot_turnstile_completed' });
        const result = await onResubmit(token);
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
        const challengeSiteKey = effectiveSiteKey;
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
}: CreateQAFlowParams) => {
  // Gate Q&A when user is logged out (unless allowAnonAccess is true)
  if (isLoggedIn === false && !allowAnonAccess) {
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
    pendingQuery: null as { query: string; sessionId: string | null; queryId: string } | null,
    needsChallenge: false,
  };

  // Mutable ref to injectMessage — captured from chatState on each message call
  // so the Turnstile onVerify callback can inject responses into the chat.
  let injectMessage: ((msg: string) => Promise<void>) | null = null;

  // Auto-resubmit after visible Turnstile challenge completes.
  // Called from TurnstileWidgetWrapper's onVerify — fetches the pending query
  // with the new token and injects the response directly into the chat.
  // Returns: 'success' | 'needs_another_challenge' | 'error'
  const handleTurnstileResubmit = async (token: string): Promise<'success' | 'needs_another_challenge' | 'error'> => {
    if (!turnstileState.pendingQuery || !injectMessage) {
      logger.error('Turnstile resubmit called without pending query or injectMessage');
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

      const retryBody: Record<string, string> = {
        query: turnstileState.pendingQuery.query,
        question_id: turnstileState.pendingQuery.queryId,
        turnstile_token: token,
      };
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

      const retryResponse = await fetch(endpoint, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(retryBody),
      });

      const savedQueryId = turnstileState.pendingQuery.queryId;

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
                else if (evType === 'done') doneMetadata = (parsed.metadata as Record<string, unknown>) || {};
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

        if (!collectedTokens) throw new Error('No content received from stream');

        lastRatingTarget = (doneMetadata.rating_target as string) || null;
        lastIsFinalResponse = doneMetadata.is_final_response === true;
        feedbackQueryId = savedQueryId;

        const processedText = getProcessedText(collectedTokens);
        await injectMessage(processedText);

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
        await injectMessage("Still verifying — please complete the challenge again.");
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

      await injectMessage(fullContent);

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
      await injectMessage?.("I had trouble processing your question after verification. Please try again.");
      return 'error';
    }
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

                await fetch(targetEndpoint, {
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

        // Process as a question
        try {
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
          const requestBody: Record<string, string> = {
            query: userInput,
            question_id: queryId
          };
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

          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify(requestBody)
          });

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

            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events from buffer (events are separated by double newlines)
                let boundary = buffer.indexOf('\n\n');
                while (boundary !== -1) {
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
              if (streamStarted) {
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
            turnstileState.pendingQuery = { query: userInput, sessionId: currentSessionId, queryId };
            turnstileState.needsChallenge = true;
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
          logger.error('Error in Q&A flow:', error);

          // Track error event
          trackEvent?.({
            type: 'chatbot_answer_error',
            queryId: feedbackQueryId ?? undefined,
            errorType: error instanceof Error ? error.message : 'unknown'
          });

          return "I apologize, but I'm having trouble processing your question. Please try again later.";
        }
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
          trackEvent={trackEvent}
          loginUrl={loginUrl}
        />
      ),
      path: "qa_loop"
    }
  };
};
