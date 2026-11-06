/**
 * react-chatbotify's simulated streaming never renders under jsdom. Component
 * tests mock ../config with this so messages appear at once:
 *
 *   jest.mock('../config', () => require('../test-utils/config-without-stream').default());
 */
export default function configWithoutStream() {
  const actual = jest.requireActual('../config');
  return {
    ...actual,
    fixedReactChatbotifySettings: {
      ...actual.fixedReactChatbotifySettings,
      botBubble: { ...actual.fixedReactChatbotifySettings.botBubble, simulateStream: false },
    },
  };
}
