/**
 * Changes the agent has prepared but not made. Write tools return a preview
 * in the SSE done event; the change happens only when the user confirms, which
 * sends the preview ids back as confirm_ids. Titles and wording match the
 * full-screen client (chatbot-fullscreen-client src/lib/confirm.ts).
 */

export interface Preview {
  previewId: string;
  tool: string;
  data: Record<string, unknown>;
  /** Nothing would change, so there is nothing to confirm. */
  noChanges: boolean;
}

const PREVIEW_ID = /^[0-9a-f]{32}$/;

/** The most ids the agent accepts in one confirm. */
export const MAX_CONFIRM_IDS = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** The done event's previews, skipping any entry without a valid id or with a repeated one. */
export function parsePreviews(raw: unknown): Preview[] {
  if (!Array.isArray(raw)) return [];
  const previews: Preview[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const id = entry.preview_id;
    if (typeof id !== 'string' || !PREVIEW_ID.test(id)) continue;
    // Identical calls in one step share an id; the card shows it once.
    if (previews.some((p) => p.previewId === id)) continue;
    const data = isRecord(entry.data) ? entry.data : {};
    previews.push({
      previewId: id,
      tool: typeof entry.tool === 'string' ? entry.tool : '',
      data,
      noChanges: entry.no_changes === true || data.no_changes === true,
    });
  }
  return previews;
}

export const PREVIEW_TITLES: Record<string, string> = {
  register_for_event: 'Register for this event',
  cancel_registration: 'Cancel your registration',
  create_event: 'Create this event',
  update_event: 'Update this event',
  delete_event: 'Cancel this event series',
  restore_event: 'Restore this event',
  send_for_review: 'Send this event for review',
  cancel_occurrence: 'Cancel this occurrence',
  restore_occurrence: 'Restore this occurrence',
  edit_occurrence: 'Edit this occurrence',
  add_occurrence: 'Add an occurrence',
  create_announcement: 'Post this announcement',
  update_announcement: 'Update this announcement',
  delete_announcement: 'Delete this announcement',
  create_support_ticket: 'Open this support ticket',
  create_login_ticket: 'Open this login help ticket',
  report_security_incident: 'Report this security incident',
};

function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** The card heading for a tool; "some_tool" becomes "Some tool". */
export function previewTitle(tool: string): string {
  return PREVIEW_TITLES[tool] ?? (humanize(tool) || 'Change');
}

export interface PreviewRow {
  label: string;
  /** Plain text. Long text is shown in full. */
  value: string;
}

const FLAG_NOTES: Record<string, string> = {
  detail_unavailable: "Current details couldn't be loaded.",
  current_state_unavailable: "The current state couldn't be loaded.",
  registrants_notified_on_commit: 'Registrants will be emailed about this change.',
  registrants_may_be_notified: 'Registrants may be emailed about this change.',
  dates_incomplete: "Not all of this series' dates could be loaded.",
  no_changes: "This doesn't change anything.",
};

const HIDDEN = new Set(['preview_id', 'status', 'action']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Entities decoded once, as a browser shows them. */
function decode(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex ?? '', 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

// A comment, or a tag whose attributes may hold quoted ">".
const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
// Attributes that load or link somewhere, shown for any tag that has them.
const URL_ATTRS = ['href', 'src', 'srcset', 'action', 'formaction', 'data', 'poster', 'background'];
const BLOCKS = /^(p|div|h[1-6]|ul|ol|blockquote|table|tr|pre)$/;

/** A tag's attributes, the first of each name winning as in a browser. */
function attributes(source: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const [, name, d, s, bare] of source.matchAll(ATTR)) {
    const key = name.toLowerCase();
    if (!attrs.has(key)) attrs.set(key, decode(d ?? s ?? bare ?? ''));
  }
  return attrs;
}

/**
 * HTML from a body field as the text a reader sees. Every link target and
 * every source a tag loads stays in view, since the card is what the user
 * approves.
 */
export function htmlText(html: string): string {
  let out = '';
  let last = 0;
  const links: string[] = [];
  const closeLink = () => {
    const href = links.pop();
    if (href) out += ` (${href})`;
  };
  for (const match of html.matchAll(TAG)) {
    out += decode(html.slice(last, match.index));
    last = (match.index ?? 0) + match[0].length;
    const [, slash, rawName, rawAttrs] = match;
    if (rawName === undefined) continue;
    const name = rawName.toLowerCase();
    if (slash) {
      if (name === 'a') closeLink();
      else if (name === 'li') out += '\n';
      else if (BLOCKS.test(name)) out += '\n\n';
      continue;
    }
    const attrs = attributes(rawAttrs);
    if (name === 'a') {
      links.push(attrs.get('href') ?? '');
      continue;
    }
    if (name === 'br') out += '\n';
    else if (name === 'li') out += '• ';
    const urls = URL_ATTRS.flatMap((a) => attrs.get(a) || []);
    if (name === 'img') out += urls.length ? `[image: ${urls.join(', ')}]` : '[image]';
    else if (urls.length) out += `[${name}: ${urls.join(', ')}]`;
  }
  out += decode(html.slice(last));
  while (links.length) closeLink();
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Fields whose value is HTML: an announcement body, an event description. */
const isHtmlField = (key: string) => /(^|_)(body|description)$/i.test(key);

function scalar(value: unknown, html = false): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'string') return html ? htmlText(value) : value;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map((v) => scalar(v, html)).join(', ') || 'none';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const isChange = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && typeof value.field === 'string';

function changeRow(change: Record<string, unknown>): PreviewRow {
  const field = change.field as string;
  const html = isHtmlField(field);
  const old = change.old_unavailable === true ? 'unknown' : scalar(change.old, html);
  return { label: humanize(field), value: `${old} → ${scalar(change.new, html)}` };
}

/** Flags turned into short sentences, plus rows for the rest of the data. */
export function previewDetails(data: Record<string, unknown>): { notes: string[]; rows: PreviewRow[] } {
  const notes: string[] = [];
  const rows: PreviewRow[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (HIDDEN.has(key)) continue;
    // A time the user can read stands in for its UTC form: start_local for
    // start_date, shown as "Start".
    const local = key.match(/^(.*)_local$/)?.[1];
    if (local && typeof value === 'string' && value) {
      rows.push({ label: humanize(local), value });
      continue;
    }
    const dated = key.match(/^(.*)_date$/)?.[1];
    const localOf = dated && data[`${dated}_local`];
    if (typeof localOf === 'string' && localOf) continue;
    if (key in FLAG_NOTES) {
      if (value === true) notes.push(FLAG_NOTES[key]);
      continue;
    }
    if (Array.isArray(value) && value.length > 0 && value.every(isChange)) {
      rows.push(...value.map(changeRow));
    } else if (isRecord(value)) {
      for (const [inner, innerValue] of Object.entries(value)) {
        rows.push({ label: `${humanize(key)} ${inner.replace(/[_-]+/g, ' ')}`, value: scalar(innerValue, isHtmlField(inner)) });
      }
    } else {
      rows.push({ label: humanize(key), value: scalar(value, isHtmlField(key)) });
    }
  }
  return { notes, rows };
}
