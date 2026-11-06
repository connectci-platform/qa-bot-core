import React, { useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import QABot from './components/QABot';
import reportWebVitals from './reportWebVitals';

function ExampleApp() {
  // Analytics event handler for testing
  const handleAnalyticsEvent = useCallback((event) => {
    console.log('[Analytics]', event.type, event);
  }, []);
  const [userLoggedIn, setUserLoggedIn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [messageToSend, setMessageToSend] = useState('Hello from the Chatbot');
  const botRef = useRef();

  // Read from environment variables
  const apiKey = process.env.REACT_APP_API_KEY || null;
  const qaEndpoint = process.env.REACT_APP_QA_ENDPOINT || null;
  const ratingEndpoint = process.env.REACT_APP_RATING_ENDPOINT || null;
  // Agent-targeted answers (rating_target: "agent") rate to this endpoint.
  // Without it, those answers show no thumbs even when ratingEndpoint is set.
  const agentRatingEndpoint = process.env.REACT_APP_AGENT_RATING_ENDPOINT || null;
  // Agent mode: tokens from the identity site at REACT_APP_SUPPORT_URL, sent
  // only to REACT_APP_AGENT_URL. See "Agent mode" in the README.
  const agentUrl = process.env.REACT_APP_AGENT_URL || null;
  const supportUrl = (process.env.REACT_APP_SUPPORT_URL || '').replace(/\/$/, '') || null;
  const agentAuthConfig = agentUrl && supportUrl
    ? { tokenUrl: `${supportUrl}/api/agent-token`, loginUrl: `${supportUrl}/user/login`, agentUrl }
    : null;
  const [agentMode, setAgentMode] = useState(false);
  const agentAuth = agentMode && agentAuthConfig ? agentAuthConfig : undefined;

  // Environment variables are now used directly

  const handleSendMessage = () => {
    if (botRef.current && messageToSend.trim()) {
      botRef.current.addMessage(messageToSend);
      setMessageToSend('');
    }
  };

  const handleEmbeddedChange = (newEmbedded) => {
    setEmbedded(newEmbedded);
  };

  return (
    <div className="demo-layout">
      <div className="demo-header">
        <div className="demo-title">
          QA Bot Core: React Component Demo
        </div>
      </div>

      <div className="demo-content">
        {/* Left Panel: Controls */}
        <div className="demo-left-panel">
          <div className="demo-section">
            <h2>Configuration Status</h2>
            <div className="config-item">
              <div className="config-prop">API Key</div>
              <div className="config-value">
                {apiKey ? '✓ Configured' : '✗ Not set'}
              </div>
              <div className="config-desc">REACT_APP_API_KEY</div>
            </div>

            <div className="config-item">
              <div className="config-prop">Q&A Endpoint</div>
              <div className="config-value">
                {qaEndpoint ? '✓ Configured' : '✗ Not set'}
              </div>
              <div className="config-desc">
                REACT_APP_QA_ENDPOINT
                {qaEndpoint && <div style={{fontSize: '0.8em', marginTop: '4px', wordBreak: 'break-all'}}>{qaEndpoint}</div>}
              </div>
            </div>

            <div className="config-item">
              <div className="config-prop">Rating Endpoint</div>
              <div className="config-value">
                {ratingEndpoint ? '✓ Configured' : '✗ Not set'}
              </div>
              <div className="config-desc">
                REACT_APP_RATING_ENDPOINT (optional)
                {ratingEndpoint && <div style={{fontSize: '0.8em', marginTop: '4px', wordBreak: 'break-all'}}>{ratingEndpoint}</div>}
              </div>
            </div>
          </div>

          <div className="demo-section">
            <h2>Dynamic Props</h2>
            <p className="demo-help">Control bot visibility and availability via props</p>

            <label className="demo-checkbox">
              <input
                type="checkbox"
                checked={userLoggedIn}
                onChange={(e) => setUserLoggedIn(e.target.checked)}
              />
              <span>{userLoggedIn ? 'User logged in' : 'User not logged in'}</span>
              <code className="demo-prop-name">isLoggedIn={userLoggedIn ? 'true' : 'false'}</code>
            </label>
            <label className="demo-checkbox">
              <input
                type="checkbox"
                checked={chatOpen}
                onChange={(e) => setChatOpen(e.target.checked)}
                disabled={embedded}
              />
              <span>{chatOpen ? 'Chat window open' : 'Chat window closed'}</span>
              <code className="demo-prop-name">open={chatOpen ? 'true' : 'false'}</code>
            </label>
            <label className="demo-checkbox">
              <input
                type="checkbox"
                checked={embedded}
                onChange={(e) => handleEmbeddedChange(e.target.checked)}
              />
              <span>{embedded ? 'Embedded mode (always visible)' : 'Floating mode (toggle button)'}</span>
              <code className="demo-prop-name">embedded={embedded ? 'true' : 'false'}</code>
            </label>
            <label className="demo-checkbox">
              <input
                type="checkbox"
                checked={agentMode}
                onChange={(e) => setAgentMode(e.target.checked)}
                disabled={!agentAuthConfig}
              />
              <span>{agentAuthConfig ? (agentMode ? 'Agent sign-in on' : 'Agent sign-in off') : 'Agent sign-in (set REACT_APP_AGENT_URL and REACT_APP_SUPPORT_URL)'}</span>
              <code className="demo-prop-name">agentAuth={agentMode ? '{…}' : 'undefined'}</code>
            </label>
          </div>

          <div className="demo-section">
            <h2>Component API</h2>
            <p className="demo-help">Use imperative methods to inject messages</p>
            <div className="demo-method-signature">
              <code>addMessage(message: string)</code>
            </div>

            <div className="demo-field">
              <label htmlFor="message-input">Message:</label>
              <input
                id="message-input"
                type="text"
                value={messageToSend}
                onChange={(e) => setMessageToSend(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type a message..."
                className="demo-input"
              />
            </div>
            <button
              onClick={handleSendMessage}
              className="demo-send-button"
              disabled={!messageToSend.trim()}
            >
              Send Message
            </button>
          </div>
        </div>

        {/* Right Panel: Chatbot Preview */}
        <div className="demo-right-panel">
          {embedded ? (
            <div className="demo-bot-preview">
              <h2>Embedded Mode Preview</h2>
              <p className="demo-help">Bot displays inline, always visible</p>
              <QABot
                key={`embedded-mode-${agentMode}`}
                ref={botRef}
                apiKey={apiKey}
                qaEndpoint={qaEndpoint}
                ratingEndpoint={ratingEndpoint}
                agentRatingEndpoint={agentRatingEndpoint}
                welcomeMessage="What can I help you with?"
                botName="Q&A Assistant"
                placeholder="Type your question here..."
                tooltipText="Click to chat with our Q&A assistant!"
                isLoggedIn={userLoggedIn}
                open={chatOpen}
                onOpenChange={setChatOpen}
                embedded={true}
                actingUser="demo-user@access-ci.org"
                onAnalyticsEvent={handleAnalyticsEvent}
                agentAuth={agentAuth}
              />
            </div>
          ) : (
            <div className="demo-bot-preview">
              <h2>Floating Mode Preview</h2>
              <p className="demo-help">Bot appears as a button in the bottom-right corner</p>
              <div className="floating-preview-placeholder">
                <p>👉 Look for the chat button in the bottom-right corner of the page</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating bot (only rendered when not embedded) */}
      {!embedded && (
        <QABot
          key={`floating-mode-${agentMode}`}
          ref={botRef}
          apiKey={apiKey}
          qaEndpoint={qaEndpoint}
          ratingEndpoint={ratingEndpoint}
          agentRatingEndpoint={agentRatingEndpoint}
          welcomeMessage="What can I help you with?"
          botName="Q&A Assistant"
          placeholder="Type your question here..."
          tooltipText="Click to chat with our Q&A assistant!"
          isLoggedIn={userLoggedIn}
          open={chatOpen}
          onOpenChange={setChatOpen}
          embedded={false}
          actingUser="demo-user@access-ci.org"
          onAnalyticsEvent={handleAnalyticsEvent}
          agentAuth={agentAuth}
        />
      )}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ExampleApp />
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
