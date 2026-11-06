import { useEffect, useState, type RefObject } from 'react';

export const TOOLTIP_DISMISSED_KEY = 'qa_bot_tooltip_dismissed';

interface TooltipVisibilityOptions {
  containerRef: RefObject<HTMLElement>;
  embedded: boolean;
  oncePerSession: boolean;
  bottomOffset: number;
}

// Storage can throw, for example with site data blocked. The callout then lasts
// for the page view rather than the session.
const readDismissed = (): boolean => {
  try {
    return window.sessionStorage.getItem(TOOLTIP_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
};

const saveDismissed = (): void => {
  try {
    window.sessionStorage.setItem(TOOLTIP_DISMISSED_KEY, 'true');
  } catch {
    // See readDismissed.
  }
};

const overlaps = (a: DOMRect, b: DOMRect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Whether to hide the floating chat callout, so it doesn't cover footer links.
 * It hides once the chat has been opened this session, near the bottom of the
 * page, and while a focused element sits under it (WCAG 2.2 SC 2.4.11).
 *
 * The callout stays in CLOSE mode and is hidden with a CSS class. react-chatbotify's
 * START mode would be the natural fit, but the flag it sets is one of its own
 * effect's dependencies, so the callout hides itself straight after showing.
 */
export default function useTooltipVisibility({
  containerRef,
  embedded,
  oncePerSession,
  bottomOffset,
}: TooltipVisibilityOptions): boolean {
  const [dismissed, setDismissed] = useState(() => oncePerSession && readDismissed());
  const [nearBottom, setNearBottom] = useState(false);
  const [focusCovered, setFocusCovered] = useState(false);

  useEffect(() => {
    if (embedded || !oncePerSession) return undefined;

    const onToggle = (event: Event) => {
      if ((event as Event & { data?: { newState?: boolean } }).data?.newState) {
        saveDismissed();
        setDismissed(true);
      }
    };

    window.addEventListener('rcb-toggle-chat-window', onToggle);
    return () => window.removeEventListener('rcb-toggle-chat-window', onToggle);
  }, [embedded, oncePerSession]);

  useEffect(() => {
    if (embedded) return undefined;

    let scheduled = false;
    let frame = 0;

    // The callout is fixed, so scrolling can move a focused element under it
    // with no focus event, which is why this checks focus too.
    const checkFocus = () => {
      const tooltip = containerRef.current?.querySelector('.rcb-chat-tooltip');
      const focused = document.activeElement;
      setFocusCovered(
        !!tooltip &&
          !!focused &&
          focused !== document.body &&
          overlaps(tooltip.getBoundingClientRect(), focused.getBoundingClientRect())
      );
    };

    const check = () => {
      const pageBottom = document.documentElement.scrollHeight;
      setNearBottom(window.scrollY + window.innerHeight >= pageBottom - bottomOffset);
      checkFocus();
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      frame = window.requestAnimationFrame(() => {
        scheduled = false;
        check();
      });
    };

    check();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', checkFocus);
    document.addEventListener('focusout', checkFocus);

    // Lazy-loaded content can change the page height with no scroll or resize.
    const observer = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
    observer?.observe(document.body);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', checkFocus);
      document.removeEventListener('focusout', checkFocus);
      observer?.disconnect();
    };
  }, [embedded, bottomOffset, containerRef]);

  return !embedded && (dismissed || nearBottom || focusCovered);
}
