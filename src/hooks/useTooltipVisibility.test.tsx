import React, { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import useTooltipVisibility, { TOOLTIP_DISMISSED_KEY } from './useTooltipVisibility';

type Options = { embedded?: boolean; oncePerSession?: boolean; bottomOffset?: number };

const Harness = ({ embedded = false, oncePerSession = true, bottomOffset = 300 }: Options) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const hidden = useTooltipVisibility({ containerRef, embedded, oncePerSession, bottomOffset });
  return (
    <div ref={containerRef} data-testid="bot" data-hidden={hidden}>
      <div className="rcb-chat-tooltip" />
    </div>
  );
};

const isHidden = () => screen.getByTestId('bot').getAttribute('data-hidden') === 'true';

const toggleChat = (newState: boolean) =>
  act(() => {
    const event = new CustomEvent('rcb-toggle-chat-window') as CustomEvent & { data: unknown };
    event.data = { currState: !newState, newState };
    window.dispatchEvent(event);
  });

const setPage = (scrollY: number, pageHeight = 3000, viewport = 800) => {
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: viewport, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: pageHeight,
    configurable: true,
  });
};

const scrollTo = (scrollY: number) =>
  act(() => {
    setPage(scrollY);
    window.dispatchEvent(new Event('scroll'));
  });

const box = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect;

const addFocusable = (rect: DOMRect) => {
  const button = document.createElement('button');
  button.getBoundingClientRect = () => rect;
  document.body.appendChild(button);
  return button;
};

const placeTooltip = (rect: DOMRect) => {
  const tooltip = document.querySelector('.rcb-chat-tooltip') as HTMLElement;
  tooltip.getBoundingClientRect = () => rect;
};

describe('useTooltipVisibility', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    setPage(0);
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('once per session', () => {
    it('shows the callout when the chat has not been opened this session', () => {
      render(<Harness />);
      expect(isHidden()).toBe(false);
    });

    it('hides the callout on a later page once the chat has been opened', () => {
      window.sessionStorage.setItem(TOOLTIP_DISMISSED_KEY, 'true');
      render(<Harness />);
      expect(isHidden()).toBe(true);
    });

    it('records the dismissal and stays hidden after the chat opens and closes', () => {
      render(<Harness />);
      toggleChat(true);
      expect(window.sessionStorage.getItem(TOOLTIP_DISMISSED_KEY)).toBe('true');
      toggleChat(false);
      expect(isHidden()).toBe(true);
    });

    it('ignores the chat closing', () => {
      render(<Harness />);
      toggleChat(false);
      expect(window.sessionStorage.getItem(TOOLTIP_DISMISSED_KEY)).toBeNull();
      expect(isHidden()).toBe(false);
    });

    it('still works when storage throws', () => {
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      render(<Harness />);
      expect(isHidden()).toBe(false);
      toggleChat(true);
      expect(isHidden()).toBe(true);
    });

    it('keeps showing after the chat closes when turned off', () => {
      render(<Harness oncePerSession={false} />);
      toggleChat(true);
      toggleChat(false);
      expect(isHidden()).toBe(false);
    });
  });

  describe('near the bottom of the page', () => {
    it('hides within the offset and comes back on scrolling up', () => {
      render(<Harness />);
      scrollTo(1950);
      expect(isHidden()).toBe(true);
      scrollTo(500);
      expect(isHidden()).toBe(false);
    });

    it('checks the position on load', () => {
      setPage(2200);
      render(<Harness />);
      expect(isHidden()).toBe(true);
    });

    it('respects a custom offset', () => {
      render(<Harness bottomOffset={50} />);
      scrollTo(1950);
      expect(isHidden()).toBe(false);
    });

    it('rechecks when the page changes height without scrolling', () => {
      let notify = () => {};
      const disconnect = jest.fn();
      window.ResizeObserver = jest.fn((callback: () => void) => {
        notify = callback;
        return { observe: jest.fn(), disconnect, unobserve: jest.fn() };
      }) as unknown as typeof ResizeObserver;

      setPage(500, 1000);
      const { unmount } = render(<Harness />);
      expect(isHidden()).toBe(true);
      act(() => {
        setPage(500, 3000);
        notify();
      });
      expect(isHidden()).toBe(false);

      unmount();
      expect(disconnect).toHaveBeenCalled();
      delete (window as Partial<typeof window>).ResizeObserver;
    });

    it('rechecks on resize', () => {
      render(<Harness />);
      act(() => {
        setPage(0, 900, 800);
        window.dispatchEvent(new Event('resize'));
      });
      expect(isHidden()).toBe(true);
    });
  });

  describe('keyboard focus', () => {
    it('hides while a focused element sits under the callout', () => {
      render(<Harness />);
      placeTooltip(box(900, 700, 1200, 760));
      const link = addFocusable(box(1000, 720, 1100, 740));
      act(() => link.focus());
      expect(isHidden()).toBe(true);
      act(() => link.blur());
      expect(isHidden()).toBe(false);
    });

    it('hides when scrolling moves a focused element under the callout', () => {
      render(<Harness />);
      placeTooltip(box(900, 700, 1200, 760));
      const link = addFocusable(box(10, 10, 100, 40));
      act(() => link.focus());
      expect(isHidden()).toBe(false);
      link.getBoundingClientRect = () => box(1000, 720, 1100, 740);
      scrollTo(100);
      expect(isHidden()).toBe(true);
    });

    it('comes back when scrolling moves a focused element out from under it', () => {
      render(<Harness />);
      placeTooltip(box(900, 700, 1200, 760));
      const link = addFocusable(box(1000, 720, 1100, 740));
      act(() => link.focus());
      expect(isHidden()).toBe(true);
      link.getBoundingClientRect = () => box(10, 10, 100, 40);
      scrollTo(100);
      expect(isHidden()).toBe(false);
    });

    it('stays visible when the focused element is elsewhere', () => {
      render(<Harness />);
      placeTooltip(box(900, 700, 1200, 760));
      const link = addFocusable(box(10, 10, 100, 40));
      act(() => link.focus());
      expect(isHidden()).toBe(false);
    });
  });

  it('leaves the embedded bot alone', () => {
    window.sessionStorage.setItem(TOOLTIP_DISMISSED_KEY, 'true');
    setPage(2200);
    render(<Harness embedded />);
    expect(isHidden()).toBe(false);
  });

  it('removes its listeners on unmount', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Harness />);
    unmount();
    expect(remove.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(['rcb-toggle-chat-window', 'scroll', 'resize'])
    );
  });
});
