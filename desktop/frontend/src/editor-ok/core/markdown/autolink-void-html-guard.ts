import type { Nodes, Root } from 'mdast';
import { visit } from 'unist-util-visit';

const GUARD_OPEN = '\uE000';
const GUARD_CLOSE = '\uE001';
const GUARD_COLON = '\uE002';
const GUARD_AT = '\uE003';
const GUARD_OPEN_BRACE = '\uE004';

const LITERAL_SENTINEL_ESCAPES: ReadonlyArray<readonly [string, string]> = [
  [GUARD_OPEN, '\uE005'],
  [GUARD_CLOSE, '\uE006'],
  [GUARD_COLON, '\uE007'],
  [GUARD_AT, '\uE008'],
  [GUARD_OPEN_BRACE, '\uE009'],
];
const HAS_LITERAL_SENTINEL_RE = /[\uE000-\uE004]/;
const HAS_ESCAPED_LITERAL_SENTINEL_RE = /[\uE005-\uE009]/;

export const R23_GUARD_SUBSTITUTIONS: ReadonlyArray<{ from: string; to: string }> = [
  { from: '<', to: GUARD_OPEN },
  { from: '>', to: GUARD_CLOSE },
  { from: ':', to: GUARD_COLON },
  { from: '@', to: GUARD_AT },
  { from: '{', to: GUARD_OPEN_BRACE },
];

export const R23_SENTINEL_ESCAPE_SUBSTITUTIONS: ReadonlyArray<{ from: string; to: string }> =
  LITERAL_SENTINEL_ESCAPES.map(([from, to]) => ({ from, to }));

const AUTOLINK_RE = /<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]+)>/g;

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

const HTML_CLOSE_TAG_RE = /<\/([a-z][a-z0-9]*)\s*>/g;

const LOWERCASE_HTML_TAG_RE = /<([a-z][a-z0-9]*)(\s[^>]*)?\/?>/g;

const LOWERCASE_JSX_CANONICAL_TAGS = new Set(['img', 'video', 'audio']);

const LOWERCASE_PAIRED_JSX_TAGS = new Set(['mark']);

const UPPERCASE_CLOSE_TAG_INDEX_RE = /<\/([A-Z][A-Za-z0-9.]*)>/g;

function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function indexUppercaseCloseTagsByName(source: string): Map<string, number[]> {
  const index = new Map<string, number[]>();
  const re = new RegExp(UPPERCASE_CLOSE_TAG_INDEX_RE.source, 'g');
  let m = re.exec(source);
  while (m !== null) {
    const existing = index.get(m[1]);
    if (existing) existing.push(m.index);
    else index.set(m[1], [m.index]);
    m = re.exec(source);
  }
  return index;
}

function indexParagraphBreaks(source: string): number[] {
  const breaks: number[] = [];
  const re = /\n\s*\n/g;
  let m = re.exec(source);
  while (m !== null) {
    breaks.push(m.index);
    m = re.exec(source);
  }
  return breaks;
}

function indexSelfClose(source: string): number[] {
  const positions: number[] = [];
  let i = source.indexOf('/>');
  while (i !== -1) {
    positions.push(i);
    i = source.indexOf('/>', i + 2);
  }
  return positions;
}

function indexGreaterThan(source: string): number[] {
  const positions: number[] = [];
  let i = source.indexOf('>');
  while (i !== -1) {
    positions.push(i);
    i = source.indexOf('>', i + 1);
  }
  return positions;
}

const ANGLE_DEST_SCAN_CAP = 1024;

function isAngleBracketDestinationOpen(offset: number, result: string): boolean {
  if (result[offset - 1] !== '(' || result[offset - 2] !== ']') return false;
  const labelEnd = offset - 2;
  let bs = 0;
  for (let j = labelEnd - 1; j >= 0 && result[j] === '\\'; j--) bs++;
  if (bs % 2 === 1) return false;

  let foundLabelStart = false;
  const scanFloor = Math.max(0, labelEnd - ANGLE_DEST_SCAN_CAP);
  for (let j = labelEnd - 1; j >= scanFloor; j--) {
    const ch = result[j];
    if (ch === '\n' || ch === '\r' || ch === '`') return false;
    if (ch !== '[' && ch !== ']') continue;
    let k = 0;
    for (let m = j - 1; m >= 0 && result[m] === '\\'; m--) k++;
    if (k % 2 === 1) continue;
    if (ch === ']') return false;
    if (result[j + 1] === '^') return false;
    if (result[j - 1] === ']') return false;
    foundLabelStart = true;
    break;
  }
  if (!foundLabelStart) return false;

  let sawWhitespace = false;
  let destClose = -1;
  const scanCeil = Math.min(result.length, offset + 1 + ANGLE_DEST_SCAN_CAP);
  for (let j = offset + 1; j < scanCeil; j++) {
    const ch = result[j];
    if (ch === '>') {
      destClose = j;
      break;
    }
    if (ch === '<' || ch === '\\' || ch === '\n' || ch === '\r') return false;
    if (
      ch === GUARD_OPEN ||
      ch === GUARD_CLOSE ||
      ch === GUARD_COLON ||
      ch === GUARD_AT ||
      ch === GUARD_OPEN_BRACE
    ) {
      return false;
    }
    if (ch === ' ' || ch === '\t') sawWhitespace = true;
  }
  if (destClose === -1 || !sawWhitespace) return false;
  return result[destClose + 1] === ')';
}

function isSelfClosingTagAt(
  offset: number,
  result: string,
  greaterThanOffsets: number[],
  paragraphBreaks: number[],
): boolean {
  const gtIdx = lowerBound(greaterThanOffsets, offset);
  if (gtIdx >= greaterThanOffsets.length) return false;
  const tagClose = greaterThanOffsets[gtIdx];
  const pbIdx = lowerBound(paragraphBreaks, offset);
  const nextBlankLine = pbIdx < paragraphBreaks.length ? paragraphBreaks[pbIdx] : result.length;
  if (tagClose >= nextBlankLine) return false; // tag never closes before a blank line
  return result[tagClose - 1] === '/';
}

export function protectFromMdx(source: string): string {
  let result = source;

  if (HAS_LITERAL_SENTINEL_RE.test(result)) {
    for (const [sentinel, escapeChar] of LITERAL_SENTINEL_ESCAPES) {
      result = result.replaceAll(sentinel, escapeChar);
    }
  }

  result = result.replace(HTML_COMMENT_RE, (match) => {
    return match.replace(/</g, GUARD_OPEN).replace(/>/g, GUARD_CLOSE);
  });

  result = result.replace(AUTOLINK_RE, (_match, uri: string) => {
    const safe = uri.replaceAll(':', GUARD_COLON).replaceAll('@', GUARD_AT);
    return `${GUARD_OPEN}${safe}${GUARD_CLOSE}`;
  });

  result = result.replace(HTML_CLOSE_TAG_RE, (match, tag: string) => {
    if (LOWERCASE_PAIRED_JSX_TAGS.has(tag)) return match;
    return match.replace(/</g, GUARD_OPEN).replace(/>/g, GUARD_CLOSE);
  });

  result = result.replace(LOWERCASE_HTML_TAG_RE, (match, tag: string) => {
    if (LOWERCASE_JSX_CANONICAL_TAGS.has(tag) && match.endsWith('/>')) {
      return match;
    }
    if (LOWERCASE_PAIRED_JSX_TAGS.has(tag)) {
      return match;
    }
    if (tag[0] === tag[0].toLowerCase() && tag[0] !== tag[0].toUpperCase()) {
      return match.replace(/</g, GUARD_OPEN).replace(/>/g, GUARD_CLOSE);
    }
    return match;
  });

  result = result.replace(/<>/g, `${GUARD_OPEN}${GUARD_CLOSE}`);

  const closeTagOffsets = indexUppercaseCloseTagsByName(result);
  const paragraphBreaks = indexParagraphBreaks(result);
  const selfCloseOffsets = indexSelfClose(result);
  const greaterThanOffsets = indexGreaterThan(result);

  result = result.replace(/</g, (match, offset) => {
    if (isAngleBracketDestinationOpen(offset, result)) return match;

    const lookahead = result.slice(offset, offset + 256);

    if (lookahead[1] === '/') {
      if (/^<\/[a-zA-Z][a-zA-Z0-9.]*[ \t]*>/.test(lookahead)) return match;
      return GUARD_OPEN; // Incomplete close tag — protect
    }

    const lowercaseNameMatch = /^<([a-z][a-z0-9]*)/.exec(lookahead);
    if (
      lowercaseNameMatch &&
      LOWERCASE_JSX_CANONICAL_TAGS.has(lowercaseNameMatch[1]) &&
      isSelfClosingTagAt(offset, result, greaterThanOffsets, paragraphBreaks)
    ) {
      return match;
    }

    const lowercasePairedMatch = /^<([a-z][a-z0-9]*)([\s/>])/.exec(lookahead);
    if (lowercasePairedMatch && LOWERCASE_PAIRED_JSX_TAGS.has(lowercasePairedMatch[1])) {
      const pairedTagName = lowercasePairedMatch[1];
      if (lookahead.startsWith(`<${pairedTagName}/>`)) {
        return match;
      }
      if (result.indexOf(`</${pairedTagName}>`, offset) !== -1) {
        return match;
      }
      return GUARD_OPEN;
    }

    const tagMatch = /^<([A-Z][a-zA-Z0-9.]*)[\s/>]/.exec(lookahead);
    if (!tagMatch) {
      return GUARD_OPEN;
    }

    const tagName = tagMatch[1];

    const pbIdx = lowerBound(paragraphBreaks, offset);
    const nextBlankLine = pbIdx < paragraphBreaks.length ? paragraphBreaks[pbIdx] : result.length;

    const scIdx = lowerBound(selfCloseOffsets, nextBlankLine);
    if (scIdx > 0) {
      const lastSelfCloseAbs = selfCloseOffsets[scIdx - 1];
      if (lastSelfCloseAbs > offset) {
        const tagEndAbs = offset + tagMatch[0].length - 1;
        const betweenContent = result.slice(tagEndAbs, lastSelfCloseAbs);
        const withoutQuotes = betweenContent.replace(/"[^"]*"|'[^']*'/g, '');
        if (!withoutQuotes.includes('/')) {
          return match; // Self-closing — safe for mdx-jsx
        }
      }
    }

    const positions = closeTagOffsets.get(tagName);
    if (positions) {
      const idx = lowerBound(positions, offset);
      if (idx < positions.length) {
        return match; // Has matching close tag — safe for mdx-jsx
      }
    }

    return GUARD_OPEN;
  });

  {
    const unmatchedPositions: number[] = [];
    const stack: number[] = [];
    for (let i = 0; i < result.length; i++) {
      if (result[i] === '\n') {
        const next = result[i + 1];
        if (next === '\n' || next === '>') {
          unmatchedPositions.push(...stack);
          stack.length = 0;
          if (next === '\n') {
            while (result[i + 1] === '\n') i++;
          }
          continue;
        }
      }
      if (result[i] === '{' || result[i] === '}') {
        let bs = 0;
        for (let j = i - 1; j >= 0 && result[j] === '\\'; j--) bs++;
        if (bs % 2 === 1) continue; // escaped — skip stack operations
        if (result[i] === '{') stack.push(i);
        else if (stack.length > 0) stack.pop(); // matched pair within same block
      }
    }
    unmatchedPositions.push(...stack);

    if (unmatchedPositions.length > 0) {
      const chars = result.split('');
      for (const pos of unmatchedPositions) {
        chars[pos] = GUARD_OPEN_BRACE;
      }
      result = chars.join('');
    }
  }

  return result;
}

function hasSentinels(s: string): boolean {
  return HAS_LITERAL_SENTINEL_RE.test(s) || HAS_ESCAPED_LITERAL_SENTINEL_RE.test(s);
}

export function restoreFromMdx() {
  return (tree: Root) => {
    visit(tree, (node: Nodes) => {
      const rec = node as unknown as Record<string, unknown>;
      if (typeof rec.value === 'string' && hasSentinels(rec.value)) {
        rec.value = restoreString(rec.value);
      }
      if (typeof rec.url === 'string' && hasSentinels(rec.url)) {
        rec.url = restoreString(rec.url);
      }
      if (typeof rec.title === 'string' && hasSentinels(rec.title)) {
        rec.title = restoreString(rec.title);
      }
      if (typeof rec.alt === 'string' && hasSentinels(rec.alt)) {
        rec.alt = restoreString(rec.alt);
      }
      if (typeof rec.lang === 'string' && hasSentinels(rec.lang)) {
        rec.lang = restoreString(rec.lang);
      }
      if (typeof rec.meta === 'string' && hasSentinels(rec.meta)) {
        rec.meta = restoreString(rec.meta);
      }
    });
  };
}

function restoreString(s: string): string {
  let out = s
    .replaceAll(GUARD_OPEN, '<')
    .replaceAll(GUARD_CLOSE, '>')
    .replaceAll(GUARD_COLON, ':')
    .replaceAll(GUARD_AT, '@')
    .replaceAll(GUARD_OPEN_BRACE, '{');
  if (HAS_ESCAPED_LITERAL_SENTINEL_RE.test(out)) {
    for (const [sentinel, escapeChar] of LITERAL_SENTINEL_ESCAPES) {
      out = out.replaceAll(escapeChar, sentinel);
    }
  }
  return out;
}
