import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PreviewCard from './PreviewCard';
import type { Preview } from '../utils/preview';

const id = (n: number) => n.toString(16).padStart(32, '0');

const preview = (n: number, overrides: Partial<Preview> = {}): Preview => ({
  previewId: id(n),
  tool: 'register_for_event',
  data: { event_title: `Workshop ${n}` },
  noChanges: false,
  ...overrides,
});

function renderCard(previews: Preview[], { stale = false } = {}) {
  const onSend = jest.fn(async (_text: string, _ids: string[]) => {});
  let isStale = stale;
  const listeners = new Set<() => void>();
  const utils = render(
    <PreviewCard
      previews={previews}
      onSend={onSend}
      isStale={() => isStale}
      subscribe={(listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }}
    />,
  );
  const goStale = () =>
    act(() => {
      isStale = true;
      listeners.forEach((listener) => listener());
    });
  return { ...utils, onSend, goStale };
}

describe('PreviewCard', () => {
  it('shows the title, notes and rows of a preview', () => {
    renderCard([
      preview(1, { data: { event_title: 'Workshop', registrants_notified_on_commit: true } }),
    ]);

    expect(screen.getByRole('region', { name: 'Changes waiting for your confirmation' })).toBeInTheDocument();
    expect(screen.getByText('Register for this event')).toBeInTheDocument();
    expect(screen.getByText('Event title')).toBeInTheDocument();
    expect(screen.getByText('Workshop')).toBeInTheDocument();
    expect(screen.getByText('Registrants will be emailed about this change.')).toBeInTheDocument();
    expect(screen.getByText('Nothing changes until you confirm.')).toBeInTheDocument();
  });

  it('reads a row value as itself and leaves short values out of the tab order', () => {
    renderCard([preview(1, { data: { event_title: 'Workshop' } })]);

    const value = screen.getByText('Workshop');
    expect(value.tagName).toBe('DD');
    expect(value).not.toHaveAttribute('aria-label');
    expect(value).not.toHaveAttribute('tabindex');
  });

  it('confirms one preview with Confirm', () => {
    const { onSend } = renderCard([preview(1)]);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onSend).toHaveBeenCalledWith('Confirm', [id(1)]);
  });

  it('confirms several with Confirm all, leaving out a preview with no changes', () => {
    const { onSend } = renderCard([preview(1), preview(2), preview(3, { noChanges: true })]);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm all' }));

    expect(onSend).toHaveBeenCalledWith('Confirm', [id(1), id(2)]);
  });

  it('cancels with no ids', () => {
    const { onSend } = renderCard([preview(1)]);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSend).toHaveBeenCalledWith('Cancel', []);
  });

  it('sends once on a double click and stays disabled', () => {
    const { onSend } = renderCard([preview(1)]);
    const confirm = screen.getByRole('button', { name: 'Confirm' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('shows a no-changes preview as a note with no Confirm', () => {
    renderCard([preview(1, { noChanges: true })]);

    expect(screen.getByText('Register for this event: nothing would change.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm/ })).not.toBeInTheDocument();
  });

  it('disables Confirm with a message when there are more than ten', () => {
    const previews = Array.from({ length: 11 }, (_, i) => preview(i + 1));
    const { onSend } = renderCard(previews);

    const confirm = screen.getByRole('button', { name: 'Confirm all' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/too many changes to confirm at once/)).toBeInTheDocument();
    fireEvent.click(confirm);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('disables its buttons once a newer turn starts', () => {
    const { onSend, goStale } = renderCard([preview(1)]);

    goStale();

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('starts disabled when already stale', () => {
    renderCard([preview(1)], { stale: true });

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });
});
