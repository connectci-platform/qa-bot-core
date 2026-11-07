import { getProcessedText } from './getProcessedText';

describe('getProcessedText', () => {
  // The first pass exists to rescue UKY RAG output that wrapped bare URLs in
  // square brackets without parens (`[https://x]`), which markdown won't link.
  it('rescues a bracket-wrapped bare URL into a markdown link', () => {
    expect(getProcessedText('Visit [https://arc.ucar.edu/] for details.')).toBe(
      'Visit [https://arc.ucar.edu/](https://arc.ucar.edu/) for details.'
    );
  });

  // Regression: the agent emits proper markdown links, sometimes with the URL
  // as its own label (`[url](url)`). The first-pass regex used to also match
  // the `[url]` portion of that complete link and duplicate it.
  it('does not mangle an already-complete [url](url) link', () => {
    const input = 'See [https://arc.ucar.edu/](https://arc.ucar.edu/).';
    expect(getProcessedText(input)).toBe(input);
  });

  it('leaves human-labeled markdown links untouched', () => {
    const input = 'See [NCSA Delta Docs](https://docs.ncsa.illinois.edu/delta).';
    expect(getProcessedText(input)).toBe(input);
  });

  it('linkifies a bare URL in prose', () => {
    expect(getProcessedText('Visit https://arc.ucar.edu/ for details.')).toBe(
      'Visit [https://arc.ucar.edu/](https://arc.ucar.edu/) for details.'
    );
  });

  it('strips trailing sentence punctuation from a linkified bare URL', () => {
    expect(getProcessedText('See https://arc.ucar.edu/.')).toBe(
      'See [https://arc.ucar.edu/](https://arc.ucar.edu/).'
    );
  });

  it('returns non-string input unchanged', () => {
    expect(getProcessedText('')).toBe('');
  });

  // A `---` line directly under text makes that text a setext heading. The
  // agent's previews put one right after their field lines.
  describe('a dashed line under text', () => {
    it('becomes a divider instead of turning the text above into a heading', () => {
      expect(getProcessedText('Title: Maintenance\nSummary: Delta is down\n---\nShall I post it?')).toBe(
        'Title: Maintenance\nSummary: Delta is down\n\n---\nShall I post it?'
      );
    });

    it.each(['----', '  ---', '---   '])('treats %j as a divider too', (line) => {
      expect(getProcessedText(`Text\n${line}`)).toBe(`Text\n\n${line}`);
    });

    it('keeps Windows line endings', () => {
      expect(getProcessedText('Text\r\n---\r\nMore')).toBe('Text\r\n\r\n---\r\nMore');
    });

    it('gives the same result when run again', () => {
      const once = getProcessedText('Text\n---\nMore');
      expect(getProcessedText(once)).toBe(once);
    });

    it('still links a URL on the line above', () => {
      expect(getProcessedText('See https://arc.ucar.edu/\n---')).toBe(
        'See [https://arc.ucar.edu/](https://arc.ucar.edu/)\n\n---'
      );
    });

    it.each([
      ['a divider that already has a blank line above', 'Text\n\n---\nMore'],
      ['a divider at the start', '---\nMore'],
      ['=== under text', 'Text\n==='],
      ['-- under text', 'Text\n--'],
      ['an indented code line', 'Text\n    ---'],
      ['a spaced divider, which is never a heading', 'Text\n- - -'],
    ])('leaves %s alone', (_name, input) => {
      expect(getProcessedText(input)).toBe(input);
    });

    it.each([
      ['a backtick fence', '```yaml\ntitle: x\n---\n```'],
      ['a tilde fence', '~~~\ntitle: x\n---\n~~~'],
      ['a longer fence closed only by a matching one', '````\na\n```\nb\n---\n````'],
      ['a fence that is still streaming', 'Here:\n```\ntitle: x\n---'],
      ['a fence opened on a list line', '- ```\n  x\n  ---\n  ```'],
      ['a fence opened on a numbered list line', '1. ```\n   x\n   ---\n   ```'],
      ['a fence indented inside a list item', '- item\n\n      ```\n      x\n      ---\n      ```'],
      ['a backtick fence that a tilde line does not close', '```\n~~~\nx\n---\n```'],
      ['a fence that a line with an info string does not close', '```\n``` js\nx\n---\n```'],
    ])('leaves a dashed line inside %s alone', (_name, input) => {
      expect(getProcessedText(input)).toBe(input);
    });

    it('does not treat a backtick line whose info string has a backtick as a fence', () => {
      expect(getProcessedText('```a`b\nText\n---')).toBe('```a`b\nText\n\n---');
    });

    it('fixes a dashed line after a fence closed inside a list', () => {
      expect(getProcessedText('- ```\n  x\n  ```\n\nText\n---')).toBe('- ```\n  x\n  ```\n\nText\n\n---');
    });

    it('fixes a dashed line after a closed fence', () => {
      expect(getProcessedText('```\ncode\n```\nText\n---')).toBe('```\ncode\n```\nText\n\n---');
    });
  });
});
