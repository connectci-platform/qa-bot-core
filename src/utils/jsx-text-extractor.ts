// src/utils/jsx-text-extractor.ts

/**
 * Extracts plain text content from a JSX element or any value.
 *
 * react-chatbotify wraps bot messages in JSX before firing events,
 * even when the flow step defines a plain string like:
 *   message: "What is your help ticket related to?"
 *
 * This function recursively extracts the text so we can store it
 * in session history. Without this, bot messages would be lost
 * when restoring sessions.
 *
 * @param element - Any value (string, number, JSX element, array, etc.)
 * @returns The extracted text content, or empty string if none found
 */
export function extractTextFromJsx(element: unknown): string {
  // Base cases
  if (typeof element === 'string') {
    return element;
  }
  if (typeof element === 'number') {
    return String(element);
  }
  if (!element) {
    return '';
  }

  // Handle arrays (e.g., multiple children)
  if (Array.isArray(element)) {
    return element.map(extractTextFromJsx).join('');
  }

  // Handle React elements (objects with props.children)
  if (typeof element === 'object' && element !== null && 'props' in element) {
    const props = (element as { props?: { children?: unknown } }).props;
    if (props && 'children' in props) {
      return extractTextFromJsx(props.children);
    }
  }

  // Unknown type - return empty string
  return '';
}

/**
 * True when the element, or anything inside it, carries `data-transient`.
 * Transient messages, such as a sign-in prompt whose button would be lost,
 * are kept out of saved history. The check walks children because
 * react-chatbotify may wrap a message before firing events.
 */
export function isTransientMessage(element: unknown): boolean {
  if (!element || typeof element !== 'object') {
    return false;
  }
  if (Array.isArray(element)) {
    return element.some(isTransientMessage);
  }
  const props = (element as { props?: Record<string, unknown> }).props;
  if (!props) {
    return false;
  }
  return props['data-transient'] === true || isTransientMessage(props.children);
}
