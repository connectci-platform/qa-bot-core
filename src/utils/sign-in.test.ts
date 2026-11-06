import { openSignIn } from './sign-in';
import type { AgentTokenSource } from './agent-token';

function fakeSource() {
  return {
    getToken: jest.fn(),
    refresh: jest.fn().mockResolvedValue('t1'),
    getStatus: jest.fn(() => 'signed_out' as const),
    lastFailure: () => null,
    noteOpened: jest.fn(),
    refreshOnFocus: () => {},
    subscribe: () => () => {},
  } satisfies AgentTokenSource;
}

describe('openSignIn', () => {
  let popup: { closed: boolean; focus: jest.Mock };
  let open: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    popup = { closed: false, focus: jest.fn() };
    open = jest.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  });

  afterEach(() => {
    popup.closed = true;
    jest.advanceTimersByTime(1000);
    open.mockRestore();
    jest.useRealTimers();
  });

  it('mints again once the popup closes', () => {
    const source = fakeSource();
    openSignIn(source, 'https://support.example/user/login', jest.fn());

    jest.advanceTimersByTime(1000);
    expect(source.refresh).not.toHaveBeenCalled();
    popup.closed = true;
    jest.advanceTimersByTime(500);

    expect(source.refresh).toHaveBeenCalledTimes(1);
    expect(source.noteOpened).toHaveBeenCalled();
  });

  it('focuses the open popup instead of opening another', () => {
    const source = fakeSource();
    openSignIn(source, 'https://support.example/user/login', jest.fn());
    openSignIn(source, 'https://support.example/user/login', jest.fn());

    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalled();
  });

  it('stops watching a popup left open for a long time', () => {
    const source = fakeSource();
    openSignIn(source, 'https://support.example/user/login', jest.fn());

    jest.advanceTimersByTime(16 * 60_000);
    popup.closed = true;
    jest.advanceTimersByTime(1000);

    expect(source.refresh).not.toHaveBeenCalled();
  });

  it('falls back to a tab when popups are blocked', () => {
    open.mockReturnValueOnce(null);
    openSignIn(fakeSource(), 'https://support.example/user/login', jest.fn());

    expect(open).toHaveBeenLastCalledWith('https://support.example/user/login', '_blank');
  });
});
