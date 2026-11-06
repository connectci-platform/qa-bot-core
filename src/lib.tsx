import React from 'react';
import ReactDOM from 'react-dom/client';
import QABot from './components/QABot';
import type { BotControllerHandle, QABotAnalyticsEvent, QABotProps } from './config';
import { logger } from './utils/logger';
// CSS is extracted at build time to dist/qa-bot-core.css (see rollup.config.mjs).
// Library consumers of the ESM/CJS bundle must import the stylesheet explicitly:
//   import '@snf/qa-bot-core/dist/qa-bot-core.css';
// The standalone UMD bundle (dist/qa-bot-core.standalone.js, used by plain HTML
// pages like nairr-bot) still inlines CSS via postcss inject and needs no
// additional import from consumers.
import './styles/index.css';

// Export the main component
export { QABot };

// Export file upload components and utilities
export { FileUploadComponent } from './components/FileUploadComponent';
export type { FileUploadComponentProps } from './components/FileUploadComponent';
export { useScreenshotCapture } from './hooks/useScreenshotCapture';
export type { ScreenshotCaptureResult } from './hooks/useScreenshotCapture';
export {
  fileToBase64,
  filesToBase64,
  validateFileSize,
  formatFileSize
} from './utils/file-utils';
export type { ProcessedFile } from './utils/file-utils';

// Export flow utilities
export { applyFlowSettings } from './utils/flow-settings';
export type { FlowSettingsOptions } from './utils/flow-settings';

// Export history tracking helpers for custom flows
export { withHistory, withHistoryFn } from './utils/with-history';

// Agent mode: for wrappers that make their own agent requests (such as
// capabilities) with the same token and the same 401 handling as the bot.
export { getAgentTokenSource } from './utils/agent-token';
export type { AgentTokenSource, AuthStatus, AgentTokenErrorKind } from './utils/agent-token';
export { AgentTokenError } from './utils/agent-token';
export { agentFetch, isAgentRequest } from './utils/agent-fetch';
export { useAgentAuthStatus } from './hooks/useAgentAuthStatus';

// Export types for usage
export type {
  AgentAuthConfig,
  QABotProps,
  BotControllerHandle,
  QABotAnalyticsEvent,
  QABotAnalyticsEventType
} from './config';

/**
 * ===========================================
 * PROGRAMMATIC API TYPES
 * ===========================================
 */

/**
 * Config for the programmatic API (window.qaBotCore / qaBot()).
 * Extends QABotProps with a target element and defaultOpen,
 * and omits open/onOpenChange (managed internally).
 */
interface QABotConfig extends Omit<QABotProps, 'open' | 'onOpenChange'> {
  target: HTMLElement;
  defaultOpen?: boolean;
}

interface QABotInstance {
  addMessage: (message: string) => void;
  setBotEnabled: (status: boolean) => void;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  destroy: () => void;
}

type ProgrammaticQABotProps = Omit<QABotProps, 'open' | 'onOpenChange'> & {
  defaultOpen?: boolean;
};

/**
 * ===========================================
 * PROGRAMMATIC API IMPLEMENTATION
 * ===========================================
 */

// React wrapper component for programmatic API
const ProgrammaticQABot = React.forwardRef<BotControllerHandle, ProgrammaticQABotProps>(
  ({ defaultOpen, ...qaProps }, ref) => {
    const [isOpen, setIsOpen] = React.useState(defaultOpen || false);
    const qaRef = React.useRef<BotControllerHandle>(null);

    React.useImperativeHandle(ref, () => ({
      addMessage: (message: string) => {
        qaRef.current?.addMessage(message);
      },
      setBotEnabled: (status: boolean) => {
        qaRef.current?.setBotEnabled(status);
      },
      openChat: () => {
        setIsOpen(true);
        qaRef.current?.openChat();
      },
      closeChat: () => {
        setIsOpen(false);
        qaRef.current?.closeChat();
      },
      toggleChat: () => {
        setIsOpen(prev => !prev);
        qaRef.current?.toggleChat();
      }
    }), []);

    return (
      <QABot
        ref={qaRef}
        {...qaProps}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    );
  }
);

ProgrammaticQABot.displayName = 'ProgrammaticQABot';

/**
 * JavaScript API function - creates a QA Bot instance programmatically
 *
 * @param config Configuration object for the bot
 * @returns QABot instance with control methods
 */
export function qaBot(config: QABotConfig): QABotInstance | undefined {
  if (!config.target || !(config.target instanceof HTMLElement)) {
    logger.error('QA Bot: A valid target DOM element is required');
    return undefined;
  }

  const { target, ...programmaticProps } = config;
  const root = ReactDOM.createRoot(target);
  const wrapperRef = { current: null as BotControllerHandle | null };

  root.render(
    <React.StrictMode>
      <ProgrammaticQABot
        ref={(ref) => { wrapperRef.current = ref; }}
        {...programmaticProps}
      />
    </React.StrictMode>
  );

  return {
    addMessage: (message: string) => wrapperRef.current?.addMessage(message),
    setBotEnabled: (status: boolean) => wrapperRef.current?.setBotEnabled(status),
    openChat: () => wrapperRef.current?.openChat(),
    closeChat: () => wrapperRef.current?.closeChat(),
    toggleChat: () => wrapperRef.current?.toggleChat(),
    destroy: () => {
      wrapperRef.current = null;
      root.unmount();
    }
  };
}

export default qaBot;

