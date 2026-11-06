import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';

const SESSION_MESSAGES_KEY = 'qa_bot_session_messages';

// Maximum total messages across all sessions
const MAX_TOTAL_MESSAGES = 100;

/**
 * Stored message structure - minimal data needed for restore
 */
export interface StoredMessage {
  id: string;
  content: string;
  sender: string;
  type: string;
  timestamp: number;
}

/**
 * Session data structure
 */
export interface SessionMessageData {
  messages: StoredMessage[];
  startedAt: string;
  preview: string;
}

export interface SessionMessagesStore {
  [sessionId: string]: SessionMessageData;
}

export const generateSessionId = (): string => {
  return `qa_bot_session_${uuidv4()}`;
};


/**
 * Get the session messages store from localStorage
 */
export const getSessionMessagesStore = (): SessionMessagesStore => {
  try {
    const stored = localStorage.getItem(SESSION_MESSAGES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    // Silently fail - corrupted storage shouldn't break the app
    return {};
  }
};

/**
 * Save the session messages store to localStorage, evicting oldest sessions if over message limit
 */
const saveSessionMessagesStore = (store: SessionMessagesStore): void => {
  // Count total messages across all sessions
  const getTotalMessages = () =>
    Object.values(store).reduce((sum, session) => sum + session.messages.length, 0);

  // Evict oldest sessions until we're under the message limit
  while (getTotalMessages() > MAX_TOTAL_MESSAGES && Object.keys(store).length > 1) {
    // Find oldest session
    const oldestSessionId = Object.entries(store)
      .sort(([, a], [, b]) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())[0]?.[0];

    if (oldestSessionId) {
      delete store[oldestSessionId];
    } else {
      break;
    }
  }
  localStorage.setItem(SESSION_MESSAGES_KEY, JSON.stringify(store));
};

/**
 * Remove every conversation from history. History is one key for everyone
 * using this browser, so a sign-out clears it rather than leave the
 * signed-out user's conversations for the next person.
 */
export const clearAllSessions = (): void => {
  localStorage.removeItem(SESSION_MESSAGES_KEY);
};

/**
 * Add a message to a session's storage.
 * Called when RcbPreInjectMessageEvent fires.
 * Stores the full message so we can restore sessions without relying on RCB's history.
 */
export const addMessageToSession = (
  sessionId: string,
  messageId: string,
  messageContent: string,
  sender: string,
  type: string
): void => {
  const store = getSessionMessagesStore();

  // Initialize session if it doesn't exist
  const isNewSession = !store[sessionId];
  if (isNewSession) {
    store[sessionId] = {
      messages: [],
      startedAt: new Date().toISOString(),
      preview: ''
    };
    logger.history('NEW session created', { sessionId: sessionId.slice(-12) });
  }

  // Skip if message with this ID already exists (deduplication)
  const isDuplicate = store[sessionId].messages.some(m => m.id === messageId);
  if (isDuplicate) {
    logger.history('DUPLICATE message skipped', {
      sessionId: sessionId.slice(-12),
      messageId: messageId.slice(-8),
      sender
    });
    return;
  }

  // Store the full message
  const storedMessage: StoredMessage = {
    id: messageId,
    content: messageContent,
    sender,
    type,
    timestamp: Date.now()
  };

  store[sessionId].messages.push(storedMessage);
  logger.history('MESSAGE added', {
    sessionId: sessionId.slice(-12),
    messageId: messageId.slice(-8),
    sender,
    totalInSession: store[sessionId].messages.length
  });

  // Compute preview from first substantial bot answer
  // Bot answers are consistently long, while greetings/prompts are short
  // This avoids ambiguity between user-typed questions vs option-click messages
  // Fall back to first user message if no bot answer exists yet
  const messages = store[sessionId].messages;

  // Find first bot message that looks like an actual answer (>=100 chars)
  const MIN_BOT_ANSWER_LENGTH = 100;
  const botAnswer = messages.find(m =>
    m.sender.toLowerCase() === 'bot' &&
    m.content?.trim() &&
    m.content.length >= MIN_BOT_ANSWER_LENGTH
  );

  if (botAnswer) {
    // Use truncated bot answer as preview
    const content = botAnswer.content;
    store[sessionId].preview = content.slice(0, 50) + (content.length > 50 ? '...' : '');
  } else {
    // Fall back to first user message until we have a bot answer
    const firstUserMessage = messages.find(m =>
      m.sender.toLowerCase() === 'user' && m.content?.trim()
    );
    if (firstUserMessage && !store[sessionId].preview) {
      const content = firstUserMessage.content;
      store[sessionId].preview = content.slice(0, 50) + (content.length > 50 ? '...' : '');
    }
  }

  saveSessionMessagesStore(store);

  logger.history('STORAGE state', {
    ourSessions: Object.keys(store).length,
    ourTotalMessages: Object.values(store).reduce((sum, s) => sum + s.messages.length, 0)
  });
};

/**
 * Get all sessions with their metadata (for history display)
 */
export const getAllSessions = (): Array<{ sessionId: string } & SessionMessageData> => {
  const store = getSessionMessagesStore();
  return Object.entries(store)
    .map(([sessionId, data]) => ({ sessionId, ...data }))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
};

/**
 * Get all stored messages for a specific session.
 * Returns messages in the format needed for RCB's replaceMessages().
 */
export const getSessionMessages = (sessionId: string): StoredMessage[] => {
  const store = getSessionMessagesStore();
  return store[sessionId]?.messages || [];
};

/**
 * Get the message count for a session.
 * Used for analytics (chatbot_close, chatbot_new_chat events).
 */
export const getSessionMessageCount = (sessionId: string): number => {
  const store = getSessionMessagesStore();
  return store[sessionId]?.messages.length ?? 0;
};

/**
 * Compute how long a session has been active (in milliseconds).
 * Calculates the difference between now and the session's startedAt timestamp.
 * Used for analytics (chatbot_close event).
 */
export const computeSessionDurationMs = (sessionId: string): number => {
  const store = getSessionMessagesStore();
  const session = store[sessionId];
  if (!session?.startedAt) {
    return 0;
  }
  return Date.now() - new Date(session.startedAt).getTime();
};