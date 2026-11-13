import React from 'react';
import { MAX_CONFIRM_IDS, previewDetails, previewTitle } from '../utils/preview';
import type { Preview } from '../utils/preview';

interface PreviewCardProps {
  previews: Preview[];
  /** Sends a turn: "Confirm" with the ids to make, or "Cancel" with none. */
  onSend: (text: string, confirmIds: string[]) => unknown;
  /** True once a newer turn has started, which makes this card's answer moot. */
  isStale?: () => boolean;
  /** Re-render when isStale may have changed. */
  subscribe?: (listener: () => void) => () => void;
}

/** What the agent has prepared for one turn, with one Confirm for all of it. */
const PreviewCard: React.FC<PreviewCardProps> = ({ previews, onSend, isStale, subscribe }) => {
  // A ref, not state, so a double click sends once even before re-render.
  const used = React.useRef(false);
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => subscribe?.(rerender), [subscribe]);

  if (previews.length === 0) return null;
  const confirmable = previews.filter((p) => !p.noChanges);
  const ids = confirmable.map((p) => p.previewId);
  const tooMany = ids.length > MAX_CONFIRM_IDS;
  const done = used.current || !!isStale?.();

  const send = (text: string, confirmIds: string[]) => {
    if (used.current || isStale?.()) return;
    used.current = true;
    rerender();
    onSend(text, confirmIds);
  };

  return (
    <section className="qa-bot-preview-card" aria-label="Changes waiting for your confirmation">
      {previews.map((preview) => {
        const title = previewTitle(preview.tool);
        if (preview.noChanges) {
          return (
            <p key={preview.previewId} className="qa-bot-preview-note">
              {title}: nothing would change.
            </p>
          );
        }
        const { notes, rows } = previewDetails(preview.data);
        return (
          <div key={preview.previewId} className="qa-bot-preview">
            <h3 className="qa-bot-preview-title">{title}</h3>
            {notes.map((note) => (
              <p key={note} className="qa-bot-preview-note">
                {note}
              </p>
            ))}
            {rows.length > 0 && (
              <dl className="qa-bot-preview-rows">
                {rows.map((row, i) => (
                  <div key={`${row.label}-${i}`}>
                    <dt>{row.label}</dt>
                    <dd tabIndex={0} aria-label={`${row.label} value`}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        );
      })}
      {confirmable.length > 0 && (
        <>
          {tooMany && (
            <p className="qa-bot-preview-note">
              There are too many changes to confirm at once. Ask the assistant to do them in smaller groups.
            </p>
          )}
          <div className="qa-bot-preview-actions">
            <button
              type="button"
              className="qa-bot-preview-button qa-bot-preview-confirm"
              disabled={done || tooMany}
              onClick={() => send('Confirm', ids)}
            >
              {ids.length > 1 ? 'Confirm all' : 'Confirm'}
            </button>
            <button
              type="button"
              className="qa-bot-preview-button"
              disabled={done}
              onClick={() => send('Cancel', [])}
            >
              Cancel
            </button>
          </div>
          <p className="qa-bot-preview-hint">Nothing changes until you confirm.</p>
        </>
      )}
    </section>
  );
};

export default PreviewCard;
