// A fence may open on a list or blockquote line, and inside a list item it can
// be indented past three spaces. Matching loosely only means fewer lines get a
// blank line, which is the safe direction.
const FENCE = /^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*(`{3,}|~{3,})(.*)$/;
const DASHES = /^ {0,3}-{3,}[ \t]*\r?$/;

/**
 * Puts a blank line before a `---` line that sits directly under text, so it
 * renders as a divider. Without one, markdown makes the text above a setext
 * heading. Code fences are left alone, and an unclosed fence runs to the end,
 * as it does when an answer is still streaming.
 */
const separateDividers = (text: string): string => {
  const lines = text.split('\n');
  const out: string[] = [];
  let fence: string | null = null;

  for (const line of lines) {
    const [, marker, rest = ''] = line.match(FENCE) ?? [];
    if (fence) {
      // A closing fence uses the same character, at least as many times, and
      // nothing after it.
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && rest.trim() === '') {
        fence = null;
      }
    } else if (marker && !(marker[0] === '`' && rest.includes('`'))) {
      // A backtick fence's info string can't contain a backtick.
      fence = marker;
    } else if (DASHES.test(line) && out.length > 0 && out[out.length - 1].trim() !== '') {
      out.push(line.endsWith('\r') ? '\r' : '');
    }
    out.push(line);
  }
  return out.join('\n');
};

/**
 * Processes text to convert bare URLs into markdown hyperlinks while preserving existing links
 */
export const getProcessedText = (text: string): string => {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // First pass: Handle URLs wrapped in square brackets like [https://example.com]
  // Convert them to proper markdown links [url](url).
  // The (?!\() negative lookahead skips a [url] that is already followed by
  // "(...)", i.e. the label of a complete [url](url) markdown link — otherwise
  // the URL gets duplicated.
  let processedText = separateDividers(text).replace(/\[(https?:\/\/[^\s]+?)\](?!\()/gi, '[$1]($1)');

  // Second pass: Match bare URLs that are NOT already in markdown or HTML link format
  // This looks for URLs that are not preceded by ]( or href=" or [
  // and not followed by )
  const urlRegex = /(?<!\]\(|href=["']|\[)https?:\/\/[^\s[\]()]+/gi;

  // Replace bare URLs with markdown links
  processedText = processedText.replace(urlRegex, (url) => {
    // Clean up common punctuation that shouldn't be part of the URL
    let cleanUrl = url;
    let trailingPunctuation = '';

    // Check for trailing punctuation and remove it from the URL
    const trailingPunctuationMatch = cleanUrl.match(/([.,;:!?]+)$/);
    if (trailingPunctuationMatch) {
      trailingPunctuation = trailingPunctuationMatch[1];
      cleanUrl = cleanUrl.slice(0, -trailingPunctuation.length);
    }

    // Create markdown link with the URL as both the link text and href
    return `[${cleanUrl}](${cleanUrl})${trailingPunctuation}`;
  });

  return processedText;
};