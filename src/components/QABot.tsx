// src/components/QABot.tsx
import React, { useRef, useEffect, useMemo, forwardRef, useState, useCallback } from 'react';
import ChatBot, { ChatBotProvider, Button, useFlow } from "react-chatbotify";
import HtmlRenderer from "@rcb-plugins/html-renderer";
import MarkdownRenderer from "@rcb-plugins/markdown-renderer";
import InputValidator from "@rcb-plugins/input-validator";
import MarkdownContent from './MarkdownContent';
import BotController from './BotController';
import LoginButton from './LoginButton';
import UserIcon from './UserIcon';
import HistoryButton from './HistoryButton';
import NewChatButton from './NewChatButton';
import SessionMessageTracker from './SessionMessageTracker';
import { AgentAuthHeaderButton, AgentSignInButton } from './AgentAuthButtons';
import useThemeColors from '../hooks/useThemeColors';
import useChatBotSettings from '../hooks/useChatBotSettings';
import useFocusableSendButton from '../hooks/useFocusableSendButton';
import useKeyboardNavigation from '../hooks/useKeyboardNavigation';
import useUpdateHeader from '../hooks/useUpdateHeader';
import { useAgentAuthStatus } from '../hooks/useAgentAuthStatus';
import { useTurnstile } from '../hooks/useTurnstile';
import { createQAFlow, type AgentFlowContext } from '../utils/flows/qa-flow';
import { isAgentRequest, resolveAgentAuth } from '../utils/agent-fetch';
import { getAgentTokenSource } from '../utils/agent-token';
import {
  generateSessionId,
  getSessionMessageCount,
  computeSessionDurationMs,
  clearAllSessions
} from '../utils/session-utils';
import { SessionProvider } from '../contexts/SessionContext';
import { AnalyticsProvider, type AnalyticsEventInput } from '../contexts/AnalyticsContext';
import { logger } from '../utils/logger';
import type { Settings, Flow } from 'react-chatbotify';
import {
  fixedReactChatbotifySettings,
  defaultValues,
  type QABotProps,
  type BotControllerHandle,
  type ThemeColors
} from '../config';

const RESET_NOTICES = {
  signed_out: "You've been signed out, so this is a new conversation.",
  thread_lost: 'Your sign-in changed, so this is a new conversation. Please ask again.',
} as const;

/** Hands QABot react-chatbotify's restartFlow, which only works inside the provider. */
function FlowRestarter({ restartRef }: { restartRef: React.MutableRefObject<(() => Promise<void>) | null> }) {
  const { restartFlow } = useFlow();
  restartRef.current = restartFlow;
  return null;
}

/**
 * Q&A Bot Component - A pre-configured react-chatbotify wrapper with business logic
 */
const QABot = forwardRef<BotControllerHandle, QABotProps>((props, ref) => {
  const {
    // Required
    apiKey,
    qaEndpoint,

    // Optional functionality
    ratingEndpoint,
    agentRatingEndpoint,
    welcomeMessage,
    open,
    onOpenChange,

    // Login state props (isLoggedIn is required)
    isLoggedIn,
    allowAnonAccess = false,
    actingUser,

    // Optional branding
    primaryColor,
    secondaryColor,
    botName,
    logo,
    placeholder,
    errorMessage,

    // Layout props
    embedded,

    // Footer props
    footerText,
    footerLink,
    tooltipText,

    // Login props
    loginUrl,

    // Turnstile bot protection
    turnstileSiteKey,

    // Backend ID for proxy routing
    backendId,

    // Resource scoping
    resourceContext,

    // Custom flow extension
    customFlow,

    // Analytics callback
    onAnalyticsEvent,

    // Agent mode
    agentAuth
  } = props;

  // Instance ID - stable across component lifecycle (for unique React keys)
  const instanceIdRef = useRef<string>(`bot_${Math.random().toString(36).substr(2, 9)}`);

  // Log version on mount (when debug enabled)
  useEffect(() => {
    logger.version();
  }, []);

  // Session management - use ref so session can change without recreating flow
  // Use lazy initializer to only generate once per mount
  const sessionIdRef = useRef<string | null>(null);
  if (sessionIdRef.current === null) {
    sessionIdRef.current = generateSessionId();
    logger.session('CREATED', sessionIdRef.current);
  }

  // Track when we're resetting to prevent message replay
  const isResettingRef = useRef<boolean>(false);

  // Create a stable getter object that the flow will capture
  const sessionGetter = useRef({
    getSessionId: () => sessionIdRef.current,
    isResetting: () => isResettingRef.current
  });

  // Function to reset session ID (creates a new unique session)
  const resetSession = () => {
    const oldSessionId = sessionIdRef.current;
    isResettingRef.current = true;
    sessionIdRef.current = generateSessionId();
    logger.session('RESET', `${oldSessionId?.slice(-12)} -> ${sessionIdRef.current.slice(-12)}`);
  };

  // Function to set session ID (for restoring a previous session)
  const setSessionId = (sessionId: string) => {
    const oldSessionId = sessionIdRef.current;
    sessionIdRef.current = sessionId;
    logger.session('RESTORED', `${oldSessionId?.slice(-12)} -> ${sessionId.slice(-12)}`);
  };

  // Function to clear the resetting flag (called after flow restart completes)
  const clearResettingFlag = () => {
    isResettingRef.current = false;
  };

  // Silent Turnstile verification — renders an invisible widget on mount.
  // Token is stored in a ref so the flow can read it without recreating.
  // Pass a lightweight stub for analytics; actual trackEvent uses the
  // AnalyticsProvider set up below, which isn't available this early.
  // We proxy through a ref that the provider populates once mounted.
  const turnstileTrackRef = useRef<((e: { type: 'chatbot_turnstile_silent_failed'; failureReason: string }) => void) | null>(null);
  const turnstile = useTurnstile(turnstileSiteKey, (event) => {
    turnstileTrackRef.current?.(event);
  });
  const turnstileTokenRef = useRef<string | null>(null);
  turnstileTokenRef.current = turnstile.token;

  // Track if user is logged in (for internal reactivity)
  // Note: undefined is treated as "logged in" (open access mode)
  const [internalIsLoggedIn, setInternalIsLoggedIn] = useState<boolean | undefined>(isLoggedIn);

  // Sync isLoggedIn prop changes
  useEffect(() => {
    setInternalIsLoggedIn(isLoggedIn);
  }, [isLoggedIn]);

  // Agent mode. Keyed on the config's values, not its identity, so a host
  // that rebuilds the object each render doesn't rebuild the flow.
  const agentKey = agentAuth
    ? [agentAuth.tokenUrl, agentAuth.loginUrl, agentAuth.agentUrl, agentAuth.signInText ?? ''].join('\n')
    : '';
  const resolvedAgent = useMemo(
    () => (typeof window === 'undefined' ? null : resolveAgentAuth(agentAuth, window.location)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentKey]
  );
  const agentSource = useMemo(
    () => (resolvedAgent ? getAgentTokenSource(resolvedAgent.tokenUrl) : null),
    [resolvedAgent]
  );
  const isAgentMode = agentSource !== null;
  useEffect(() => {
    if (resolvedAgent && qaEndpoint && !isAgentRequest(resolvedAgent, qaEndpoint)) {
      console.warn('qa-bot-core: qaEndpoint is not on agentAuth.agentUrl\'s origin, so questions are sent without the agent token.');
    }
  }, [resolvedAgent, qaEndpoint]);
  // The host's login state, which agent mode ignores. Memos depend on this so
  // a host isLoggedIn change can't rebuild the settings or flow in agent mode.
  const hostLoggedIn = isAgentMode ? undefined : internalIsLoggedIn;
  const authStatus = useAgentAuthStatus(agentSource);
  // The host's setBotEnabled, kept apart from sign-in in agent mode.
  const [hostEnabled, setHostEnabled] = useState(true);
  const hostEnabledRef = useRef(true);
  hostEnabledRef.current = hostEnabled;
  const restartRef = useRef<(() => Promise<void>) | null>(null);
  const pendingNoticeRef = useRef<string | null>(null);
  // A sign-out can be seen twice, by a send and by the status change; it
  // resets the conversation once.
  const signOutHandledRef = useRef(false);
  const resetGenerationRef = useRef(0);

  // Determine if embedded (with default)
  const isEmbeddedMode = embedded !== undefined ? embedded : defaultValues.embedded;

  /**
   * Enriched analytics tracker - single source of truth for event enrichment.
   * Adds common fields (timestamp, sessionId, pageUrl, isEmbedded) to all events.
   * Used by: QABot directly, AnalyticsProvider (for child components), and qa-flow.
   */
  const trackEvent = useCallback((event: AnalyticsEventInput) => {
    if (onAnalyticsEvent) {
      onAnalyticsEvent({
        ...event,
        timestamp: Date.now(),
        sessionId: sessionIdRef.current ?? undefined,
        pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        isEmbedded: isEmbeddedMode
      });
    }
  }, [onAnalyticsEvent, isEmbeddedMode]);

  // Wire the turnstile ref to trackEvent so silent verification failures
  // flow through the same analytics pipeline as other events.
  useEffect(() => {
    turnstileTrackRef.current = (event) => trackEvent(event as AnalyticsEventInput);
  }, [trackEvent]);

  // Build settings: Fixed settings + overridable props
  const settings = useMemo((): Settings => {
    // Start with fixed settings (cannot be overridden)
    const base = { ...fixedReactChatbotifySettings };

    // Add overridable settings - use props if provided, otherwise defaults
    base.general = {
      ...base.general,
      primaryColor: primaryColor || defaultValues.primaryColor,
      secondaryColor: secondaryColor || defaultValues.secondaryColor,
      fontFamily: defaultValues.fontFamily,
      embedded: isEmbeddedMode
    };

    // Build header buttons array conditionally.
    // History is available in both states (session history is device-local and
    // doesn't require login). Logged out additionally shows the login button;
    // logged in shows the user icon.
    const headerButtons = resolvedAgent && agentSource
      ? [<HistoryButton key="history-button" />, <AgentAuthHeaderButton key="agent-auth" source={agentSource} config={resolvedAgent} />]
      : hostLoggedIn === false
        ? [<HistoryButton key="history-button" />, <LoginButton key="login-button" loginUrl={loginUrl || defaultValues.loginUrl} isHeaderButton={true} />]
        : [<HistoryButton key="history-button" />, <UserIcon key="user-icon" />];

    base.header = {
      title: <span style={{ fontSize: 14, fontWeight: 500 }}>{botName || defaultValues.botName}</span>,
      showAvatar: true,
      avatar: logo || defaultValues.avatar,
      buttons: [
        ...headerButtons,
        Button.CLOSE_CHAT_BUTTON
      ]
    };

    // Input is never globally disabled - individual flow steps control this
    base.chatInput = {
      ...base.chatInput,
      disabled: false,
      enabledPlaceholderText: placeholder || defaultValues.placeholder,
      disabledPlaceholderText: errorMessage || defaultValues.errorMessage
    };

    base.tooltip = {
      ...base.tooltip,
      text: tooltipText || defaultValues.tooltipText
    };

    // Configure footer with NewChatButton and optional text/link
    // This must be in useMemo (not useEffect) to avoid flashing the default footer
    const footerTextElement = footerText
      ? (footerLink
          ? <a href={footerLink} target="_blank" rel="noopener noreferrer" key="footer-link">{footerText}</a>
          : <span key="footer-text">{footerText}</span>)
      : null;

    base.footer = {
      text: footerTextElement ?? undefined,
      buttons: [<NewChatButton key="new-chat-button" />]
    };

    // Ensure chatWindow is a fresh object (not shared with fixedReactChatbotifySettings)
    // and set defaultOpen based on embedded mode
    base.chatWindow = {
      ...base.chatWindow,
      defaultOpen: isEmbeddedMode ? true : false
    };

    // Enable events for message tracking.
    // rcbStopStreamMessage is required so streamed bot answers get persisted —
    // streaming never fires rcbPreInjectMessage, so without this the history
    // would restore user queries with no answers. See SessionMessageTracker.
    base.event = {
      rcbPreInjectMessage: true,
      rcbPostInjectMessage: true,
      rcbStopStreamMessage: true,
      rcbUserSubmitText: true,
      rcbChangePath: true,
      rcbToggleChatWindow: true
    };

    return base;
  }, [primaryColor, secondaryColor, botName, logo, placeholder, errorMessage, isEmbeddedMode, tooltipText, hostLoggedIn, loginUrl, footerText, footerLink, resolvedAgent, agentSource]);

  // Container ref for theming
  const containerRef = useRef<HTMLDivElement>(null);
  const themeColors: ThemeColors = useThemeColors(containerRef, settings.general);

  // Update header based on login state
  useUpdateHeader(isAgentMode ? authStatus === 'signed_in' : internalIsLoggedIn !== false, containerRef);

  // Apply theme colors as CSS variables and other settings
  // Note: Footer is configured in the settings useMemo above to avoid flashing
  useChatBotSettings({ settings, themeColors });

  // Starts a new conversation the way New Chat does, then shows why. Both
  // kinds clear history, which is one store for everyone using this browser:
  // a lost thread means the agent now sees a different user, whose history
  // this isn't.
  const requestReset = useCallback((kind: 'signed_out' | 'thread_lost') => {
    if (kind === 'signed_out') {
      if (signOutHandledRef.current) return;
      signOutHandledRef.current = true;
    }
    clearAllSessions();
    resetGenerationRef.current += 1;
    pendingNoticeRef.current = RESET_NOTICES[kind];
    isResettingRef.current = true;
    sessionIdRef.current = generateSessionId();
    logger.session('RESET', kind);
    void (restartRef.current?.() ?? Promise.resolve()).finally(() => {
      setTimeout(() => {
        isResettingRef.current = false;
      }, 100);
    });
  }, []);

  const agentContext = useMemo((): AgentFlowContext | null => {
    if (!resolvedAgent || !agentSource) return null;
    return {
      config: resolvedAgent,
      source: agentSource,
      async ensureStatus() {
        agentSource.noteOpened();
        if (agentSource.getStatus() === 'unknown') {
          // A failure is read back through lastFailure() by the gate.
          await agentSource.getToken().catch(() => null);
        }
        return agentSource.getStatus();
      },
      requestReset,
      signInButton: () => <AgentSignInButton source={agentSource} config={resolvedAgent} />,
      hostEnabled: () => hostEnabledRef.current,
      resetGeneration: () => resetGenerationRef.current,
    };
  }, [resolvedAgent, agentSource, requestReset]);

  // A sign-out noticed in the background (a re-mint said login_required)
  // resets the conversation too; the agent would refuse the old thread.
  const previousStatusRef = useRef(authStatus);
  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = authStatus;
    if (authStatus === 'signed_in') {
      signOutHandledRef.current = false;
    } else if (previous === 'signed_in' && authStatus === 'signed_out') {
      requestReset('signed_out');
    }
  }, [authStatus, requestReset]);

  // Create Q&A flow directly from simple props - no intermediate layers!
  // Note: sessionGetter is stable, so flow won't recreate when session changes
  const flow = useMemo((): Flow => {
    const qaFlow = createQAFlow({
      endpoint: qaEndpoint,
      ratingEndpoint: ratingEndpoint,
      agentRatingEndpoint: agentRatingEndpoint,
      apiKey: apiKey,
      sessionId: sessionGetter.current.getSessionId,
      isResetting: sessionGetter.current.isResetting,
      isLoggedIn: hostLoggedIn,
      allowAnonAccess: allowAnonAccess,
      loginUrl: loginUrl || defaultValues.loginUrl,
      actingUser: actingUser,
      trackEvent: trackEvent,
      getTurnstileToken: () => turnstileTokenRef.current,
      resetTurnstileToken: () => turnstile.reset(),
      backendId: backendId,
      resourceContext: resourceContext,
      agent: agentContext ?? undefined,
    });

    // Configure start step
    const startStep = {
      message: welcomeMessage,
      renderMarkdown: ["BOT"],
      transition: { duration: 0 },
      path: "qa_loop"
    };

    if (agentContext) {
      // After a reset, the notice is its own step so it lands after the
      // welcome. It has no transition: one would run qa_loop with no input.
      return {
        start: {
          ...startStep,
          path: () => (pendingNoticeRef.current ? 'reset_notice' : 'qa_loop'),
        },
        reset_notice: {
          message: () => {
            const notice = pendingNoticeRef.current;
            pendingNoticeRef.current = null;
            return notice ?? '';
          },
          path: 'qa_loop',
        },
        ...qaFlow,
        ...(customFlow || {})
      };
    }

    // Merge flows: start + Q&A flow + custom flow (if provided)
    return {
      start: startStep,
      ...qaFlow,
      ...(customFlow || {})
    };
    // `turnstile` is intentionally omitted: it is only used via the stable
    // `turnstileTokenRef` (token) and a `turnstile.reset()` closure. Including
    // the hook's object — which is a new reference each render — would recreate
    // the entire flow on every render and reset the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, qaEndpoint, ratingEndpoint, agentRatingEndpoint, welcomeMessage, hostLoggedIn, allowAnonAccess, loginUrl, customFlow, actingUser, trackEvent, resourceContext, backendId, agentContext]);

  // default react-chatbotify plugins
  const plugins = useMemo(() => {
    return [HtmlRenderer(), MarkdownRenderer({ markdownComponent: MarkdownContent }), InputValidator()];
  }, []);

  // Apply hooks
  useFocusableSendButton();
  useKeyboardNavigation();

  // Track link clicks in bot messages via event delegation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleLinkClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest?.('a');
      if (!anchor) return;

      // Only track links inside the chat body (bot or user messages)
      if (!anchor.closest('.rcb-chat-body-container')) return;

      // Skip login button (tracked separately)
      if (anchor.classList.contains('qa-bot-login-button')) return;
      // Skip option buttons
      if (anchor.closest('.rcb-options-container')) return;

      trackEvent({
        type: 'chatbot_link_clicked',
        linkUrl: anchor.href,
        linkText: anchor.textContent?.trim() || ''
      });
    };

    container.addEventListener('click', handleLinkClick);
    return () => container.removeEventListener('click', handleLinkClick);
  }, [trackEvent]);

  // Listen for chat window toggle events
  useEffect(() => {
    if (!isEmbeddedMode) {
      const handleChatWindowToggle = (event: any) => {
        const newOpenState = event.data.newState;
        onOpenChange?.(newOpenState);

        const currentSessionId = sessionIdRef.current;

        // Track open/close analytics events
        if (newOpenState) {
          // Chat opened
          trackEvent({ type: 'chatbot_open' });
        } else {
          // Chat closed - include session metrics
          trackEvent({
            type: 'chatbot_close',
            messageCount: currentSessionId ? getSessionMessageCount(currentSessionId) : 0,
            durationMs: currentSessionId ? computeSessionDurationMs(currentSessionId) : 0
          });
        }
      };
      window.addEventListener('rcb-toggle-chat-window', handleChatWindowToggle);

      return () => {
        window.removeEventListener('rcb-toggle-chat-window', handleChatWindowToggle);
      };
    }
  }, [isEmbeddedMode, onOpenChange, trackEvent]);

  // Agent mode mints when the chat is first opened, never on page load: the
  // floating bot when its window opens, the embedded bot (open from the
  // start) on its first focus. The first send also mints, via ensureStatus.
  // Window focus re-mints a signed-out user who has opened the chat.
  useEffect(() => {
    if (!agentSource) return undefined;
    const open = () => {
      agentSource.noteOpened();
      agentSource.getToken().catch(() => null);
    };
    const onToggle = (event: Event) => {
      if ((event as Event & { data?: { newState?: boolean } }).data?.newState === true) open();
    };
    const onFocus = () => agentSource.refreshOnFocus();
    const container = containerRef.current;
    window.addEventListener('rcb-toggle-chat-window', onToggle);
    window.addEventListener('focus', onFocus);
    if (isEmbeddedMode) container?.addEventListener('focusin', open, { once: true });
    return () => {
      window.removeEventListener('rcb-toggle-chat-window', onToggle);
      window.removeEventListener('focus', onFocus);
      container?.removeEventListener('focusin', open);
    };
  }, [agentSource, isEmbeddedMode]);

  return (
    <div
      className={`qa-bot ${settings.general?.embedded ? "embedded-qa-bot" : ""}`}
      ref={containerRef}
      role="region"
      aria-label={`${botName || defaultValues.botName}${settings.general?.embedded ? " - Embedded" : ""}`}
    >
      <SessionProvider getSessionId={() => sessionIdRef.current!} setSessionId={setSessionId} resetSession={resetSession} clearResettingFlag={clearResettingFlag}>
        <AnalyticsProvider trackEvent={trackEvent}>
        <ChatBotProvider>
          <div>
            <SessionMessageTracker />
            <BotController
              ref={ref}
              embedded={settings.general?.embedded || false}
              currentOpen={open || false}
              enabled={isAgentMode ? hostEnabled : internalIsLoggedIn !== false}
              onSetEnabled={(enabled) => (isAgentMode ? setHostEnabled(enabled) : setInternalIsLoggedIn(enabled ? undefined : false))}
            />
            {isAgentMode && <FlowRestarter restartRef={restartRef} />}
            <ChatBot
              key={isAgentMode ? `chatbot-${instanceIdRef.current}` : `chatbot-${instanceIdRef.current}-${internalIsLoggedIn}`}
              settings={settings}
              flow={flow}
              plugins={plugins}
            />

            {/* Accessibility regions */}
            <div
              role="status"
              aria-live="polite"
              aria-label="Bot response updates"
              className="sr-only"
              id="bot-live-region"
              style={{position:'absolute',width:'1px',height:'1px',padding:0,margin:'-1px',overflow:'hidden',clip:'rect(0,0,0,0)',whiteSpace:'nowrap',border:0}}
            />
            <div id="chat-input-help" className="sr-only"
              style={{position:'absolute',width:'1px',height:'1px',padding:0,margin:'-1px',overflow:'hidden',clip:'rect(0,0,0,0)',whiteSpace:'nowrap',border:0}}
            >
              Type your message and press Enter to send. Use arrow keys to navigate through response options.
            </div>
          </div>
        </ChatBotProvider>
        </AnalyticsProvider>
      </SessionProvider>
    </div>
  );
});

QABot.displayName = 'QABot';

export default QABot;

