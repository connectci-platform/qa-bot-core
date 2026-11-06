import type { AgentTokenSource } from './agent-token';

const POPUP_POLL_MS = 500;
// Stop watching a popup left open this long; the focus re-mint still applies.
const POPUP_WATCH_MS = 15 * 60_000;

// One sign-in popup at a time per page.
let watching: { popup: Window; timer: number } | null = null;

/**
 * Opens the identity site's login in a popup and mints again once it closes.
 * When the user is already signed in elsewhere, SSO usually bounces the popup
 * straight back without a form. Falls back to a new tab when popups are
 * blocked; the focus re-mint covers that case.
 */
export function openSignIn(
  source: AgentTokenSource,
  loginUrl: string,
  onError: (error: unknown) => void,
): void {
  source.noteOpened();
  if (watching && !watching.popup.closed) {
    watching.popup.focus();
    return;
  }
  const popup = window.open(loginUrl, '_blank', 'popup,width=480,height=720');
  if (!popup) {
    window.open(loginUrl, '_blank');
    return;
  }
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    if (!popup.closed) {
      if (Date.now() - startedAt > POPUP_WATCH_MS) stop();
      return;
    }
    stop();
    // Closing the popup also refocuses this window, and that may already
    // have minted.
    if (source.getStatus() !== 'signed_in') {
      source.refresh().catch(onError);
    }
  }, POPUP_POLL_MS);
  const stop = () => {
    window.clearInterval(timer);
    if (watching?.timer === timer) watching = null;
  };
  watching = { popup, timer };
}
