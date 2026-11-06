import type { Settings, Flow } from 'react-chatbotify';

/**
 * Analytics event types fired by qa-bot-core
 */
export type QABotAnalyticsEventType =
  | 'chatbot_open'
  | 'chatbot_close'
  | 'chatbot_new_chat'
  | 'chatbot_question_sent'
  | 'chatbot_answer_received'
  | 'chatbot_answer_error'
  | 'chatbot_rating_sent'
  | 'chatbot_login_prompt_shown'
  | 'chatbot_login_clicked'
  | 'chatbot_link_clicked'
  | 'chatbot_turnstile_shown'
  | 'chatbot_turnstile_completed'
  | 'chatbot_turnstile_error'
  | 'chatbot_turnstile_silent_failed';

/**
 * Analytics event payload
 * 
 * Common fields (auto-populated for all events):
 * - timestamp: When the event occurred
 * - sessionId: Current chat session ID
 * - pageUrl: URL where the bot is displayed
 * - isEmbedded: Whether bot is in embedded mode (true) or floating/widget mode (false)
 * 
 * Event-specific fields:
 * - chatbot_open: (common fields only)
 * - chatbot_close: messageCount, durationMs
 * - chatbot_new_chat: previousMessageCount
 * - chatbot_question_sent: queryId, questionLength
 * - chatbot_answer_received: queryId, responseTimeMs, success, responseLength, hasMetadata
 * - chatbot_answer_error: queryId, errorType
 * - chatbot_rating_sent: queryId, rating
 * - chatbot_login_prompt_shown: (common fields only)
 * - chatbot_login_clicked: loginUrl
 * - chatbot_link_clicked: linkUrl, linkText
 * - chatbot_turnstile_shown: queryId — visible challenge displayed to user
 * - chatbot_turnstile_completed: queryId — user solved visible challenge
 * - chatbot_turnstile_error: queryId, failureReason — visible challenge failed
 * - chatbot_turnstile_silent_failed: failureReason — silent verification failed on page load
 */
export interface QABotAnalyticsEvent {
  type: QABotAnalyticsEventType;
  timestamp: number;
  sessionId?: string;
  // Common context fields (auto-populated)
  pageUrl?: string;
  isEmbedded?: boolean;
  // Query tracking
  queryId?: string;
  // chatbot_question_sent
  questionLength?: number;
  // chatbot_answer_received
  responseTimeMs?: number;
  success?: boolean;
  responseLength?: number;
  hasMetadata?: boolean;
  // chatbot_answer_error
  errorType?: string;
  // chatbot_turnstile_error / chatbot_turnstile_silent_failed
  failureReason?: 'widget_error' | 'token_expired' | 'script_load_failed' | 'api_unavailable' | 'user_cancelled';
  cloudflareErrorCode?: string;
  // chatbot_rating_sent
  rating?: 'helpful' | 'not_helpful';
  // chatbot_close
  messageCount?: number;
  durationMs?: number;
  // chatbot_new_chat
  previousMessageCount?: number;
  // chatbot_login_clicked
  loginUrl?: string;
  // chatbot_link_clicked
  linkUrl?: string;
  linkText?: string;
}

/**
 * Where a program's bot gets agent tokens, and where it may send them.
 * Supplied by the program's wrapper, never by an embedding page.
 */
export interface AgentAuthConfig {
  /** POST here mints an agent token with the browser's session cookie. */
  tokenUrl: string;
  /** Opened in the sign-in popup. */
  loginUrl: string;
  /** The agent's origin. The token is only ever sent to this origin. */
  agentUrl: string;
  /** Shown when a tool needs sign-in. Default: "Sign in to continue." */
  signInText?: string;
}

export interface QABotProps {
  apiKey: string;
  qaEndpoint: string;
  welcomeMessage: string;
  ratingEndpoint?: string;

  /**
   * Endpoint for the capabilities API (e.g., /api/v1/capabilities).
   * The wrapper can use this to fetch dynamic capability buttons on load.
   * Core does not fetch from this — it's a passthrough for wrappers.
   */
  capabilitiesEndpoint?: string;

  /**
   * Rating endpoint for agent-handled responses (non-RAG).
   * When the response metadata includes `rating_target: "agent"`,
   * ratings are POSTed here instead of `ratingEndpoint`.
   * Payload: { query_id, rating: "helpful"|"not_helpful", feedback? }
   */
  agentRatingEndpoint?: string;

  primaryColor?: string;
  secondaryColor?: string;
  botName?: string;
  logo?: string;
  placeholder?: string;
  errorMessage?: string;
  embedded?: boolean;
  footerText?: string;
  footerLink?: string;
  tooltipText?: string;
  loginUrl?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  /**
   * Whether the user is currently logged in.
   * - Required: this bot expects login state to be tracked
   * - Controls header icon (login button when false, user icon when true)
   * - When false, Q&A is gated by default (shows login prompt)
   */
  isLoggedIn: boolean;

  /**
   * Agent mode: authenticate to the agent with a Bearer token from the
   * program's identity site instead of cookies. Off when unset. When set,
   * `isLoggedIn` and `loginUrl` are ignored and sign-in state comes from the
   * token. Set by the program's wrapper, not by embedding pages.
   */
  agentAuth?: AgentAuthConfig;

  /**
   * Allow anonymous access to Q&A even when not logged in.
   * - Default: false (Q&A is gated when isLoggedIn is false)
   * - Set to true to bypass login gating for Q&A
   * - Does not affect custom flows (tickets, security, etc.)
   */
  allowAnonAccess?: boolean;

  /**
   * The acting user's identifier (e.g., email or username).
   * Not sent anywhere; kept so existing callers still type-check.
   */
  actingUser?: string;

  /**
   * Cloudflare Turnstile site key for bot protection.
   * When provided, an invisible Turnstile widget is rendered on mount
   * to silently verify the user.  The token is attached to every query
   * automatically.  If silent verification fails, the backend's
   * visible-challenge flow kicks in as a fallback.
   *
   * Omit or pass empty string to disable Turnstile entirely on the frontend.
   */
  turnstileSiteKey?: string;

  /**
   * Backend identifier for proxy-based deployments.
   * When using a Turnstile-validating proxy, set `qaEndpoint` to the proxy
   * URL (e.g. "/api/chat") and `backendId` to the server-side backend
   * identifier (e.g. "nairr"). The proxy resolves this ID to the actual
   * backend URL from its ALLOWED_BACKENDS env var.
   * When omitted, requests go directly to `qaEndpoint` (no proxy).
   */
  backendId?: string;

  /**
   * RP slug for resource-scoped queries (e.g. 'delta').
   * When set, sent as `rp_name` in the query POST body and as
   * `X-Origin` header (UKY RAG API contract). Also included as
   * a query param on capabilities GET when the agent is enabled.
   */
  resourceContext?: string;

  /**
   * Custom flow steps to merge with the built-in Q&A flow.
   * Use this to add ticket creation flows, feedback flows, etc.
   * These steps will be merged into the flow object.
   */
  customFlow?: Flow;

  /**
   * Callback fired when trackable events occur.
   * Use this to wire up analytics (GTM, GA4, etc.)
   *
   * @example
   * onAnalyticsEvent={(event) => {
   *   window.dataLayer?.push({ event: event.type, ...event });
   * }}
   */
  onAnalyticsEvent?: (event: QABotAnalyticsEvent) => void;
}

/**
 * Default values for overridable props
 */
export const defaultValues: {
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  botName: string;
  avatar: string;
  placeholder: string;
  errorMessage: string;
  embedded: boolean;
  tooltipText: string;
  loginUrl: string;
} = {
  primaryColor: '#1a5b6e',
  secondaryColor: '#107180',
  fontFamily: 'Arial, sans-serif',
  botName: 'Q&A Bot',
  avatar: '/chat-icon.svg',
  placeholder: 'Type your question here...',
  errorMessage: 'Select an option to continue',
  embedded: false,
  tooltipText: 'Ask me a question!',
  loginUrl: '/login'
};


/**
 * Fixed react-chatbotify settings
 */
export const fixedReactChatbotifySettings: Settings = {
  general: {
    showHeader: true,
    showFooter: true
  },
  tooltip: {
    mode: 'CLOSE'
  },
  chatInput: {
    disabled: false,
    characterLimit: 5000,
    showCharacterCount: false,
    allowNewline: true,
    blockSpam: false
  },
  chatWindow: {
    defaultOpen: false,
    showScrollbar: false
  },
  botBubble: {
    simulateStream: true,
    streamSpeed: 10,
    showAvatar: false
  },
  userBubble: {
    showAvatar: false
  },
  // Disable notification badge on chat button
  notification: {
    disabled: true,
    showCount: false
  },
  // Disable other optional features
  audio: { disabled: true },
  emoji: { disabled: true },
  fileAttachment: { disabled: true }
  // Note: We don't use RCB's chatHistory - we store messages ourselves in session-utils.ts
};


/* Utility Types */
export interface ThemeColors {
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
}

export interface BotControllerHandle {
  addMessage: (message: string) => void;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  setBotEnabled: (enabled: boolean) => void;
}

