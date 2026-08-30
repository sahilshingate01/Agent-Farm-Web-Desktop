import type { Text } from 'mdast';
import type { Point, Position } from 'unist';

function valueOffsetToSourceOffset(
  source: string,
  parentSourceStart: number,
  valueText: string,
  targetValueOffset: number,
): number {
  let srcCursor = parentSourceStart;
  let valCursor = 0;
  while (valCursor < targetValueOffset && srcCursor < source.length) {
    if (
      source[srcCursor] === '\\' &&
      srcCursor + 1 < source.length &&
      valueText[valCursor] === source[srcCursor + 1]
    ) {
      srcCursor += 2;
      valCursor += 1;
    } else {
      srcCursor += 1;
      valCursor += 1;
    }
  }
  return srcCursor;
}

function offsetToPoint(source: string, offset: number): Point {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column, offset };
}

function makePosition(source: string, startOffset: number, endOffset: number): Position {
  return {
    start: offsetToPoint(source, startOffset),
    end: offsetToPoint(source, endOffset),
  };
}

export function deriveFragmentPosition(
  source: string,
  parentNode: Text,
  valueStart: number,
  valueEnd: number,
): Position | undefined {
  if (!source || !parentNode.position || typeof parentNode.position.start?.offset !== 'number') {
    return undefined;
  }
  const parentOff = parentNode.position.start.offset;
  const srcStart = valueOffsetToSourceOffset(source, parentOff, parentNode.value, valueStart);
  const srcEnd = valueOffsetToSourceOffset(source, parentOff, parentNode.value, valueEnd);
  return makePosition(source, srcStart, srcEnd);
}
