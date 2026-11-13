import { htmlText, MAX_CONFIRM_IDS, parsePreviews, previewDetails, previewTitle } from './preview';

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);

describe('parsePreviews', () => {
  it('reads the done event previews', () => {
    expect(
      parsePreviews([
        { preview_id: ID_A, tool: 'register_for_event', data: { event: 'Workshop' }, no_changes: false },
        { preview_id: ID_B, tool: 'update_event', data: {}, no_changes: true },
      ]),
    ).toEqual([
      { previewId: ID_A, tool: 'register_for_event', data: { event: 'Workshop' }, noChanges: false },
      { previewId: ID_B, tool: 'update_event', data: {}, noChanges: true },
    ]);
  });

  it('is empty when there are no previews', () => {
    expect(parsePreviews(undefined)).toEqual([]);
    expect(parsePreviews(null)).toEqual([]);
    expect(parsePreviews('nope')).toEqual([]);
  });

  it('drops entries without a valid preview id', () => {
    expect(
      parsePreviews([
        { preview_id: 'not-hex', tool: 'x', data: {} },
        { preview_id: ID_A.toUpperCase(), tool: 'x', data: {} },
        null,
        { preview_id: ID_A, tool: 'x', data: [] },
      ]),
    ).toEqual([{ previewId: ID_A, tool: 'x', data: {}, noChanges: false }]);
  });

  it('treats no_changes inside data as no changes too', () => {
    expect(parsePreviews([{ preview_id: ID_A, tool: 'x', data: { no_changes: true } }])[0].noChanges).toBe(true);
  });
});

describe('previewTitle', () => {
  it('uses the full-screen client titles', () => {
    expect(previewTitle('register_for_event')).toBe('Register for this event');
    expect(previewTitle('create_support_ticket')).toBe('Open this support ticket');
  });

  it('humanizes an unknown tool', () => {
    expect(previewTitle('do_some-thing')).toBe('Do some thing');
    expect(previewTitle('')).toBe('Change');
  });
});

describe('previewDetails', () => {
  it('turns flags into notes and scalars into humanized rows', () => {
    const long = 'x'.repeat(2000);
    expect(
      previewDetails({
        preview_id: ID_A,
        status: 'preview',
        action: 'create',
        event_title: 'Workshop',
        description: long,
        public: true,
        tags: ['gpu', 'ai'],
        location: null,
        registrants_notified_on_commit: true,
        detail_unavailable: false,
      }),
    ).toEqual({
      notes: ['Registrants will be emailed about this change.'],
      rows: [
        { label: 'Event title', value: 'Workshop' },
        { label: 'Description', value: long },
        { label: 'Public', value: 'yes' },
        { label: 'Tags', value: 'gpu, ai' },
        { label: 'Location', value: 'none' },
      ],
    });
  });

  it('shows field changes as old and new', () => {
    expect(
      previewDetails({
        changes: [
          { field: 'start_time', old: '9:00', new: '10:00' },
          { field: 'title', old_unavailable: true, new: 'New' },
        ],
      }).rows,
    ).toEqual([
      { label: 'Start time', value: '9:00 → 10:00' },
      { label: 'Title', value: 'unknown → New' },
    ]);
  });

  it('flattens a nested object', () => {
    expect(previewDetails({ event: { start_date: '2026-12-01' } }).rows).toEqual([
      { label: 'Event start date', value: '2026-12-01' },
    ]);
  });

  it('notes an incomplete date range instead of showing it as a row', () => {
    const { notes, rows } = previewDetails({ title: 'Office Hours', dates_incomplete: true });
    expect(notes).toEqual(["Not all of this series' dates could be loaded."]);
    expect(rows).toEqual([{ label: 'Title', value: 'Office Hours' }]);
  });

  it('notes every flag', () => {
    expect(
      previewDetails({
        detail_unavailable: true,
        current_state_unavailable: true,
        registrants_may_be_notified: true,
        no_changes: true,
      }).notes,
    ).toEqual([
      "Current details couldn't be loaded.",
      "The current state couldn't be loaded.",
      'Registrants may be emailed about this change.',
      "This doesn't change anything.",
    ]);
  });
});

it('caps a confirm at ten ids', () => {
  expect(MAX_CONFIRM_IDS).toBe(10);
});

describe('card values', () => {
  it('lists a repeated preview id once', () => {
    const entry = { preview_id: 'a'.repeat(32), tool: 'create_announcement', data: {} };
    expect(parsePreviews([entry, entry])).toHaveLength(1);
  });

  it("shows a body's HTML as text, keeping link targets and image sources", () => {
    expect(htmlText('<p>One &amp; two.</p><p>Three<br>four</p>')).toBe('One & two.\n\nThree\nfour');
    expect(htmlText('<p>See <a href="https://evil.example/x">the docs</a></p>')).toBe(
      'See the docs (https://evil.example/x)',
    );
    expect(htmlText("<img src='/a.png'>")).toBe('[image: /a.png]');
    expect(htmlText('<ul><li>A</li><li>B</li></ul>')).toBe('• A\n• B');
    expect(htmlText('2 < 3 and 5 > 4')).toBe('2 < 3 and 5 > 4');
    expect(previewDetails({ body: '<b>Hi</b> there' }).rows).toEqual([{ label: 'Body', value: 'Hi there' }]);
  });

  it('shows the local time in place of the UTC one', () => {
    expect(
      previewDetails({
        start_date: '2026-11-19T19:00:00Z',
        start_local: 'Thu, Nov 19, 2026, 1:00 PM CST',
        end_date: '2026-11-19T20:00:00Z',
      }).rows,
    ).toEqual([
      { label: 'Start', value: 'Thu, Nov 19, 2026, 1:00 PM CST' },
      { label: 'End date', value: '2026-11-19T20:00:00Z' },
    ]);
  });
});
