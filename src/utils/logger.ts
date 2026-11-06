/**
 * Logger utility for QA Bot Core
 *
 * Controls debug logging via localStorage:
 * - QA_BOT_DEBUG: Set to 'true' to enable debug logging and version info
 *
 * Usage for consumers:
 *   localStorage.setItem('QA_BOT_DEBUG', 'true');  // Enable debug logs + version
 */

// localStorage key
const DEBUG_KEY = 'QA_BOT_DEBUG';

// Library version - update this when releasing (see publishing.md)
export const LIB_VERSION = '0.6.0';

export function isDebugEnabled(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_KEY) === 'true';
}

// Styled prefixes for different log types
const styles = {
  session: 'background: #1a5b6e; color: white; padding: 2px 6px; border-radius: 3px;',
  history: 'background: #7c3aed; color: white; padding: 2px 6px; border-radius: 3px;',
  message: 'background: #059669; color: white; padding: 2px 6px; border-radius: 3px;',
  turnstile: 'background: #f97316; color: white; padding: 2px 6px; border-radius: 3px;',
  version: 'background: #f59e0b; color: #000; padding: 2px 6px; border-radius: 3px 0 0 3px; font-weight: bold;',
  versionNum: 'background: #fbbf24; color: #000; padding: 2px 6px; border-radius: 0 3px 3px 0;',
};

export const logger = {
  // Log version - call once on component mount
  version: () => {
    if (isDebugEnabled()) {
      console.log(`%c QA Bot Core %c v${LIB_VERSION} `, styles.version, styles.versionNum);
    }
  },

  // Session logging - styled, only when DEBUG enabled
  session: (action: string, ...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.log(`%c[Session]%c ${action}`, styles.session, '', ...args);
    }
  },

  // History logging - styled, only when DEBUG enabled
  history: (action: string, ...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.log(`%c[History]%c ${action}`, styles.history, '', ...args);
    }
  },

  // Message tracking - styled, only when DEBUG enabled
  message: (action: string, data: Record<string, unknown>) => {
    if (isDebugEnabled()) {
      console.log(`%c[Message]%c ${action}`, styles.message, '', data);
    }
  },

  // Turnstile logging - styled, only when DEBUG enabled
  turnstile: (action: string, ...args: unknown[]) => {
    if (isDebugEnabled()) {
      console.log(`%c[Turnstile]%c ${action}`, styles.turnstile, '', ...args);
    }
  },

  // Warnings - always show
  warn: (...args: unknown[]) => {
    console.warn(...args);
  },

  // Errors - always show
  error: (...args: unknown[]) => {
    console.error(...args);
  }
};
