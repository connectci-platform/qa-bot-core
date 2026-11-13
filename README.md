# QA Bot Core

A simple React chatbot component for Q&A applications with built-in rating system.

**Pre-configured wrapper around react-chatbotify** - Just provide your API endpoints and you're done.

## Installation

```bash
npm install @snf/qa-bot-core
```

## Usage

### React Component

#### Styles

The ESM/CJS bundle ships its stylesheet as a standalone file. Import it
once in your app so the chatbot's default layout and react-chatbotify
base styles are applied:

```jsx
import '@snf/qa-bot-core/styles';
// equivalent: import '@snf/qa-bot-core/dist/qa-bot-core.css';
```

This is required for React library consumers. Without it, the component
will render unstyled.

> **Why a separate import?** The previous version auto-injected styles
> into `document.head` at runtime. That injection doesn't reach consumers
> that render inside shadow DOM (e.g. Web Components, strict CSP
> contexts). Extracting to a standalone stylesheet lets those consumers
> import it directly into their own style scope.
>
> The standalone `dist/qa-bot-core.standalone.js` UMD bundle — loaded via
> a `<script>` tag on a plain HTML page — still inlines CSS and needs no
> explicit import.

#### Link styling

`qa-bot-core` does **not** ship default link colors, weights, or text
decorations. Consumers style their own brand. If you want links inside
the chat window to have a specific look, add rules in your own
stylesheet targeting `.rcb-chat-window a` (general) and
`.rcb-chat-window .rcb-bot-message a` (links inside bot-message
bubbles). The only link rule in `qa-bot-core` is the
`@media (prefers-contrast: high)` accessibility override.

#### Basic Usage
Just provide required props, and import the stylesheet once in your app:

```jsx
import QABot from '@snf/qa-bot-core';
import '@snf/qa-bot-core/styles';

function App() {
  return (
    <QABot
      apiKey="your-api-key"
      qaEndpoint="https://your-api.com/chat"
      welcomeMessage="Hello! How can I help you today?"
      isLoggedIn={true}
    />
  );
}
```

#### Full Configuration
Customize appearance and behavior. Don't forget to import `@snf/qa-bot-core/styles` once in your entry file (see Styles above):

```jsx
<QABot
  apiKey="your-api-key"
  qaEndpoint="https://your-api.com/chat"
  ratingEndpoint="https://your-api.com/rating"
  welcomeMessage="Hello! How can I help you today?"

  // Authentication (required)
  isLoggedIn={true}
  allowAnonAccess={false}
  actingUser="user@example.com"
  loginUrl="/login"

  // Window control
  open={false}
  onOpenChange={(isOpen) => console.log('Chat is now', isOpen ? 'open' : 'closed')}

  // Branding
  primaryColor="#24292e"
  secondaryColor="#586069"
  botName="Demo Assistant"
  logo="https://github.com/github.png"

  // Messages
  placeholder="Type your message here..."
  errorMessage="Sorry, something went wrong"
  tooltipText="Ask me anything!"

  // Layout
  embedded={false}

  // Footer
  footerText="Powered by Demo Corp"
  footerLink="https://demo.com"
/>
```

### JavaScript API

```javascript
import { qaBot } from '@snf/qa-bot-core';

const bot = qaBot({
  target: document.getElementById('bot-container'),
  apiKey: 'your-api-key',
  qaEndpoint: 'https://your-api.com/chat',
  ratingEndpoint: 'https://your-api.com/rating',
  welcomeMessage: "Hello! How can I help you today?",
  isLoggedIn: true,
  primaryColor: '#24292e',
  secondaryColor: '#586069',
  botName: 'Demo Assistant',
  logo: 'https://github.com/github.png'
});

// Programmatic control
bot.openChat();
bot.closeChat();
bot.addMessage('Hello from code!');
bot.destroy();
```

### Standalone Bundle

```html
<div id="bot-container"></div>
<script src="https://unpkg.com/@snf/qa-bot-core/dist/qa-bot-core.standalone.js"></script>
<script>
  window.qaBotCore({
    target: document.getElementById('bot-container'),
    apiKey: 'your-api-key',
    qaEndpoint: 'https://your-api.com/chat',
    ratingEndpoint: 'https://your-api.com/rating',
    welcomeMessage: "Hello! How can I help you today?",
    isLoggedIn: true,
    primaryColor: '#24292e',
    secondaryColor: '#586069',
    botName: 'Demo Assistant',
    logo: 'https://github.com/github.png'
  });
</script>
```

## Configuration

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `apiKey` | string | ✅ | API key for your Q&A service |
| `qaEndpoint` | string | ✅ | Q&A API endpoint URL |
| `welcomeMessage` | string | ✅ | Initial greeting message |
| `isLoggedIn` | boolean | ✅ | Whether the user is logged in. Controls header icon and Q&A access gating |
| `ratingEndpoint` | string | ❌ | Rating API endpoint URL (enables thumbs up/down) |
| `allowAnonAccess` | boolean | ❌ | Allow Q&A access even when not logged in (default: `false`) |
| `actingUser` | string | ❌ | Not sent anywhere; kept so existing callers still type-check |
| `agentAuth` | AgentAuthConfig | ❌ | Agent mode: sign in to the agent with a Bearer token (see Agent Mode). Off when unset |
| `loginUrl` | string | ❌ | Login URL for the login button when not logged in (default: `/login`) |
| `open` | boolean | ❌ | Control chat window open/closed state |
| `onOpenChange` | function | ❌ | Callback when chat window state changes: `(open: boolean) => void` |
| `primaryColor` | string | ❌ | Main theme color (default: `#1a5b6e`) |
| `secondaryColor` | string | ❌ | Secondary theme color (default: `#107180`) |
| `botName` | string | ❌ | Bot display name (default: `Q&A Bot`) |
| `logo` | string | ❌ | Bot avatar URL (default: `/chat-icon.svg`) |
| `placeholder` | string | ❌ | Input placeholder text |
| `errorMessage` | string | ❌ | Error state message |
| `tooltipText` | string | ❌ | Tooltip text for chat toggle |
| `tooltipOncePerSession` | boolean | ❌ | Stop showing the tooltip once the chat has been opened this session (default: true) |
| `tooltipBottomOffset` | number | ❌ | Hide the tooltip within this many pixels of the page bottom, where the footer is (default: 300) |
| `embedded` | boolean | ❌ | Embedded mode (default: `false`) |
| `footerText` | string | ❌ | Footer text |
| `footerLink` | string | ❌ | Footer link URL |
| `customFlow` | Flow | ❌ | Custom flow steps to merge with built-in Q&A flow (see Custom Flows section) |
| `onAnalyticsEvent` | function | ❌ | Analytics callback: `(event: QABotAnalyticsEvent) => void` |

## Features

### Login State Management

The bot manages authentication state through the `isLoggedIn` prop:

- **Logged in (`isLoggedIn={true}`)**: Shows user icon in header, Q&A is fully accessible
- **Not logged in (`isLoggedIn={false}`)**: Shows login button in header, Q&A is gated (prompts to log in)

Example:
```jsx
const [userLoggedIn, setUserLoggedIn] = useState(false);

<QABot
  apiKey="your-api-key"
  qaEndpoint="https://your-api.com/chat"
  welcomeMessage="Hello! How can I help you today?"
  isLoggedIn={userLoggedIn}
  loginUrl="https://your-app.com/login"
/>
```

When the user is not logged in (`isLoggedIn={false}`):
- The login button appears in the chat header
- Clicking it opens the `loginUrl` in a new tab
- Q&A flow is gated and prompts users to log in

When the user is logged in (`isLoggedIn={true}`):
- A user icon appears in the chat header
- Users can ask questions normally

#### Anonymous Access

If you want to allow Q&A access without requiring login, use the `allowAnonAccess` prop:

```jsx
<QABot
  apiKey="your-api-key"
  qaEndpoint="https://your-api.com/chat"
  welcomeMessage="Hello! How can I help you today?"
  isLoggedIn={false}
  allowAnonAccess={true}
/>
```

This bypasses the login gate for Q&A while still showing the login button in the header. Note that custom flows (if any) are unaffected by this setting.

### Agent Mode

With `agentAuth` set, the bot authenticates to the agent with a short-lived
Bearer token from the program's identity site instead of cookies. Unset, the
bot behaves exactly as before. The config belongs in the program's wrapper
(for ACCESS, `@snf/access-qa-bot`), not in a prop an embedding page can set.

```jsx
<QABot
  apiKey="your-api-key"
  qaEndpoint="https://agent.example.org/api/v1/query"
  welcomeMessage="Hello! How can I help you today?"
  isLoggedIn={false} // ignored in agent mode
  agentAuth={{
    tokenUrl: 'https://support.example.org/api/agent-token',
    loginUrl: 'https://support.example.org/user/login',
    agentUrl: 'https://agent.example.org',
    signInText: 'Sign in to continue.', // optional
  }}
/>
```

How it behaves:
- **The token goes only to the agent.** Requests whose origin matches
  `agentUrl` drop cookies and carry `Authorization: Bearer …`; every other
  request (a RAG endpoint, a proxy path) is sent as before, with no token.
  `agentUrl` must be https unless the page itself is on localhost.
- **Signed-in state comes from the token**, not from `isLoggedIn`, and
  `loginUrl` is ignored. Sign-in opens `agentAuth.loginUrl` in a popup and
  fetches a token when it closes.
- **Tokens are fetched when the chat is first opened**: when the floating bot
  opens, or on the embedded bot's first focus or send. A page view never
  fetches one. A signed-out user who opened the chat is checked again when the
  window regains focus, at most once a minute.
- **A failed token request is quiet** until a sign-in is actually needed; the
  chat continues anonymously meanwhile (subject to `allowAnonAccess`).
- **When the agent refuses a tool**, the bot explains after the reply: a
  sign-in prompt, or "Changes aren't available here." when this site can't
  make changes.
- **Changes wait for Confirm.** When the agent prepares a change (an event
  registration, a support ticket, an announcement or an event edit), its
  `done` event lists `previews`, and the bot shows them in one card after the
  reply. Confirm sends the next turn as "Confirm" with the preview ids in
  `confirm_ids`; Cancel sends "Cancel" with none. Both go through the same
  request as a typed question. The card's buttons work once, and stop working
  when a newer question is sent. A preview with nothing to change is shown as
  a note with no Confirm, and more than 10 changes can't be confirmed at once.
- **Signing out starts a new conversation and clears saved history**, which is
  one store for everyone using the browser. A thread the agent no longer lets
  this page continue also starts over. Signing out of the identity site
  doesn't revoke the token already held, so the bot notices at its next token
  fetch: up to the token's lifetime (15 minutes for ACCESS) later.
- **One token source per identity site per bundle.** Bots in the same bundle
  share it; a separately bundled copy has its own.

Wrappers that make their own agent requests use the same token and 401
handling through the exports `getAgentTokenSource`, `agentFetch` and
`useAgentAuthStatus`.

### Chat Window Control

Control the chat window open/closed state programmatically:

```jsx
const [chatOpen, setChatOpen] = useState(false);

<QABot
  apiKey="your-api-key"
  qaEndpoint="https://your-api.com/chat"
  welcomeMessage="Hello! How can I help you today?"
  isLoggedIn={true}
  open={chatOpen}
  onOpenChange={setChatOpen}
/>

<button onClick={() => setChatOpen(true)}>Open Chat</button>
<button onClick={() => setChatOpen(false)}>Close Chat</button>
```

The `open` prop provides two-way binding:
- Setting `open={true}` opens the chat window
- Setting `open={false}` closes the chat window
- User interactions (clicking open/close buttons) trigger `onOpenChange`

### Imperative API

You can also control the bot imperatively using a ref:

```jsx
const botRef = useRef();

<QABot
  ref={botRef}
  apiKey="your-api-key"
  qaEndpoint="https://your-api.com/chat"
  welcomeMessage="Hello! How can I help you today?"
  isLoggedIn={true}
/>

// Available methods:
botRef.current.openChat();           // Open the chat window
botRef.current.closeChat();          // Close the chat window
botRef.current.toggleChat();         // Toggle chat window state
botRef.current.addMessage("Hello!"); // Inject a message into the chat
botRef.current.setBotEnabled(false); // Change enabled state
```

### Embedded Mode

The bot supports two display modes:

**Floating Mode (default):**
- Shows as a toggle button in the bottom-right corner
- Chat window can be opened/closed by clicking the button
- Overlays on top of page content

**Embedded Mode:**
- Displays inline within your page layout
- Always visible (no toggle button)
- Takes full width of its container
- Chat window cannot be closed

Example of embedded mode:
```jsx
<div style={{ maxWidth: '800px', margin: '0 auto' }}>
  <h1>Customer Support</h1>
  <QABot
    apiKey="your-api-key"
    qaEndpoint="https://your-api.com/chat"
    welcomeMessage="Hello! How can I help you today?"
    isLoggedIn={true}
    embedded={true}
  />
</div>
```

**Note:** When `embedded={true}`, the `open` and `onOpenChange` props are ignored, and the imperative methods `openChat()`, `closeChat()`, and `toggleChat()` have no effect.

### Custom Flows

You can extend the bot with custom flow steps using the `customFlow` prop. This allows you to add ticket creation, feedback forms, or other interactive workflows that merge with the built-in Q&A flow.

```jsx
import QABot from '@snf/qa-bot-core';

const myCustomFlow = {
  submit_ticket: {
    message: "I'll help you submit a ticket. What's the issue?",
    path: "ticket_details"
  },
  ticket_details: {
    message: "Thanks! Your ticket has been submitted.",
    path: "start"
  }
};

<QABot
  apiKey="your-api-key"
  qaEndpoint="https://your-api.com/chat"
  welcomeMessage="Hello! How can I help you today?"
  isLoggedIn={true}
  customFlow={myCustomFlow}
/>
```

Custom flows are merged into the flow object, so your custom steps can reference built-in steps and vice versa.

#### Flow Settings Utility

When building custom flows, you may encounter a react-chatbotify quirk where `chatDisabled` state persists across step transitions. The `applyFlowSettings` utility helps manage this:

```javascript
import { applyFlowSettings } from '@snf/qa-bot-core';

const myFlow = {
  choose_option: {
    message: "Select an option:",
    options: ["Option A", "Option B"],
    path: "next_step"
  },
  next_step: {
    message: "You selected an option!",
    path: "start"
  }
};

// Auto-disable chat input on steps with options/checkboxes
const processedFlow = applyFlowSettings(myFlow, {
  disableOnOptions: true
});

<QABot
  // ...other props
  customFlow={processedFlow}
/>
```

The `disableOnOptions: true` setting automatically sets `chatDisabled: true` for steps that have `options` or `checkboxes`, and `chatDisabled: false` for steps without them (unless you've explicitly set `chatDisabled` yourself).

#### History Tracking for Custom Flows

When building custom flows, you may want certain important messages to be saved in session history so they can be restored when a user revisits a previous session. By default, messages defined with the `message:` property in flow steps may not be tracked in history.

Use the `withHistory` and `withHistoryFn` helpers to ensure messages are tracked:

```javascript
import { withHistory, withHistoryFn } from '@snf/qa-bot-core';

const myFlow = {
  // Static message - use withHistory()
  ask_email: {
    message: withHistory("Please enter your email address:"),
    path: "next_step"
  },

  // Dynamic message - use withHistoryFn()
  show_summary: {
    message: withHistoryFn(() => {
      const data = getFormData();
      return `Summary:\nName: ${data.name}\nEmail: ${data.email}`;
    }),
    options: ["Submit", "Cancel"],
    path: "submit"
  },

  // Success message with important data (e.g., ticket links)
  success: {
    message: withHistoryFn(() => generateSuccessMessage(result)),
    options: ["Back to Menu"],
    path: "start"
  }
};
```

**When to use these helpers:**
- `withHistory(string)` - For static messages you want restored in history
- `withHistoryFn(fn)` - For dynamic/computed messages (summaries, API responses with links)

**Tip:** You don't need to wrap every message - only the important ones that would be valuable when restoring a session (like ticket confirmations, summaries, or API responses).

### Session Management

The bot automatically manages conversation sessions with unique session IDs:

- Each bot instance generates a unique session ID when mounted
- The session ID is included in API request headers (`X-Session-ID`)
- A "New Chat" button in the footer allows users to start fresh conversations
- Clicking "New Chat" generates a new session ID and clears the conversation history
- This allows your backend to track conversation continuity and user journeys

**Session Headers Sent to API:**
```
X-Session-ID: qa_bot_session_abc123
X-Query-ID: query_xyz789
```

The session ID persists across page refreshes, but clicking "New Chat" creates a completely new session. This is useful for:
- Starting a new topic without the bot referencing previous context
- Resetting conversation state
- Allowing users to have multiple distinct conversations

### Analytics Events

The bot fires analytics events via an optional callback prop, allowing you to wire up GTM, GA4, or any analytics provider without adding dependencies to the library.

```jsx
<QABot
  apiKey="your-api-key"
  qaEndpoint="https://your-api.com/chat"
  welcomeMessage="Hello! How can I help you today?"
  isLoggedIn={true}
  onAnalyticsEvent={(event) => {
    // Push to GTM dataLayer
    window.dataLayer?.push({
      event: event.type,
      ...event
    });
  }}
/>
```

**Event Types:**

| Event | When Fired | Key Fields |
|-------|------------|------------|
| `chatbot_open` | Chat window opened | `sessionId` |
| `chatbot_close` | Chat window closed | `sessionId`, `messageCount`, `durationMs` |
| `chatbot_new_chat` | User clicks "New Chat" | `sessionId`, `previousMessageCount` |
| `chatbot_question_sent` | User submits question | `sessionId`, `queryId`, `questionLength` |
| `chatbot_answer_received` | API returns response | `sessionId`, `queryId`, `responseTimeMs`, `responseLength`, `hasMetadata` |
| `chatbot_answer_error` | API call fails | `sessionId`, `queryId`, `errorType` |
| `chatbot_rating_sent` | User rates response | `sessionId`, `queryId`, `rating` |
| `chatbot_login_prompt_shown` | Login gate displayed | `sessionId` |
| `chatbot_login_clicked` | User clicks login link | `sessionId`, `loginUrl` |
| `chatbot_link_clicked` | User clicks a link in a bot message | `sessionId`, `linkUrl`, `linkText` |
| `chatbot_turnstile_shown` | Visible Turnstile challenge displayed | `sessionId`, `queryId` |
| `chatbot_turnstile_completed` | User solved visible challenge | `sessionId` |
| `chatbot_turnstile_error` | Visible challenge failed or was cancelled | `sessionId`, `queryId`, `failureReason`, `cloudflareErrorCode` |
| `chatbot_turnstile_silent_failed` | Silent verification failed on page load | `sessionId`, `failureReason`, `cloudflareErrorCode` |

All events include `type` and `timestamp`. The `sessionId` is auto-injected when available.

See **[docs/analytics.md](docs/analytics.md)** for the full event reference, wiring examples, and monitoring guidance.

**TypeScript:**

```typescript
import type { QABotAnalyticsEvent, QABotAnalyticsEventType } from '@snf/qa-bot-core';
```

### Debug Logging

The bot includes a lightweight logging utility that's disabled by default but can be enabled at runtime for troubleshooting. Logs are controlled via `localStorage`, making it easy to debug in any environment (including production) without rebuilding.

**Enable debug logging:**
```javascript
localStorage.setItem('QA_BOT_DEBUG', 'true');
```

**Disable debug logging (default):**
```javascript
localStorage.removeItem('QA_BOT_DEBUG');
```

When enabled, you'll see styled console output for:
- Library version on load
- Session lifecycle events (CREATED, RESET, RESTORED)
- History operations (message tracking, session restore)
- Message tracking (which messages are being saved to history)

Errors and warnings always display regardless of the debug flag.

## API Requirements

Your Q&A endpoint should accept POST requests:

```json
POST /your-qa-endpoint
Content-Type: application/json
X-API-KEY: your-api-key

{
  "query": "User's question here"
}
```

And return:
```json
{
  "response": "Bot's answer with **markdown** support",
  "sessionId": "session_123",
  "queryId": "query_456"
}
```

### Rating Endpoint (Optional)

For thumbs up/down feedback:
```json
POST /your-rating-endpoint
Content-Type: application/json
X-API-KEY: your-api-key

{
  "sessionId": "session_123",
  "queryId": "query_456",
  "rating": 1  // 1 for 👍, 0 for 👎
}
```

## Development

### Demo Application

The project includes an interactive demo that showcases all features:

```bash
# Install dependencies
npm install

# Run demo app
npm start
```

The demo runs at `http://localhost:3000` and includes:

**Configuration Status**
- Shows which environment variables are configured
- Displays API endpoints for verification

**Dynamic Props**
- Toggle `isLoggedIn` prop to simulate login/logout states
- Toggle `open` prop to control chat window state
- Toggle `embedded` prop to switch between floating and embedded modes

**Component API**
- Test the imperative `addMessage()` method
- Inject custom messages into the chat

**Environment Variables**

Create a `.env` file in the project root:

```bash
REACT_APP_API_KEY=your-api-key
REACT_APP_QA_ENDPOINT=https://your-api.com/chat
REACT_APP_RATING_ENDPOINT=https://your-api.com/rating  # optional
```

**Agent mode locally**

Minting needs the page to be same-site with the identity site, so a
`localhost` page can't sign in to a ddev Drupal. Serve the demo from
`https://chat.accessmatch.ddev.site`: its ddev nginx rule sends `/api/` to
the agent on port 8000 and everything else to port 3000, where `npm start`
listens (stop any other dev server there first). In `.env.development.local`:

```bash
REACT_APP_QA_ENDPOINT=https://chat.accessmatch.ddev.site/api/v1/query
REACT_APP_AGENT_RATING_ENDPOINT=https://chat.accessmatch.ddev.site/api/v1/rating
REACT_APP_AGENT_URL=https://chat.accessmatch.ddev.site
REACT_APP_SUPPORT_URL=https://accessmatch.ddev.site
# CRA rejects the proxied Host header, and hot reload comes back through nginx.
DANGEROUSLY_DISABLE_HOST_CHECK=true
WDS_SOCKET_PORT=443
```

Then tick **Agent sign-in** in the demo. The origin must be registered in the
ddev site's `access.token_exchange` config.

### Building

```bash
# Build library
npm run build:lib
```

### Turnstile widget styling

The Turnstile challenge modal only appears when the backend proxy requests it, which makes iterating on its styling slow. To force it to render unconditionally, set `VITE_FORCE_TURNSTILE_WIDGET=true` in the consumer's `.env` — the widget will mount on every chat session using `VITE_TURNSTILE_SITE_KEY` as its site key. The modal `onVerify`/`onError` callbacks still fire but no-op gracefully since there's no pending query to resubmit. Leave unset in production.


## License

MIT License
