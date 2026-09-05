import { TextDecoder } from 'node:util';

export class StrictJsonValidationError extends Error {
  constructor() {
    super('JSON input is invalid or ambiguous.');
    this.name = 'StrictJsonValidationError';
  }
}

function invalid() {
  throw new StrictJsonValidationError();
}

function validateJsonWithoutDuplicateKeys(text) {
  let index = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;

  function whitespace() {
    while (
      text[index] === ' ' ||
      text[index] === '\t' ||
      text[index] === '\r' ||
      text[index] === '\n'
    ) {
      index += 1;
    }
  }

  function string() {
    if (text[index] !== '"') invalid();
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text.charCodeAt(index);
      if (character === 0x22) {
        index += 1;
        return JSON.parse(text.slice(start, index));
      }
      if (character < 0x20) invalid();
      if (character !== 0x5c) {
        index += 1;
        continue;
      }
      index += 1;
      const escaped = text[index];
      if (escaped === 'u') {
        if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 1, index + 5))) invalid();
        index += 5;
        continue;
      }
      if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped)) invalid();
      index += 1;
    }
    invalid();
  }

  function number() {
    numberPattern.lastIndex = index;
    const match = numberPattern.exec(text);
    if (match === null) invalid();
    index = numberPattern.lastIndex;
  }

  function value(depth) {
    if (depth > 128) invalid();
    whitespace();
    if (text[index] === '"') {
      string();
      return;
    }
    if (text[index] === '{') {
      object(depth + 1);
      return;
    }
    if (text[index] === '[') {
      list(depth + 1);
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    number();
  }

  function object(depth) {
    index += 1;
    whitespace();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    const keys = new Set();
    while (index < text.length) {
      const key = string();
      if (keys.has(key)) invalid();
      keys.add(key);
      whitespace();
      if (text[index] !== ':') invalid();
      index += 1;
      value(depth);
      whitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      if (text[index] !== ',') invalid();
      index += 1;
      whitespace();
    }
    invalid();
  }

  function list(depth) {
    index += 1;
    whitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    while (index < text.length) {
      value(depth);
      whitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      if (text[index] !== ',') invalid();
      index += 1;
    }
    invalid();
  }

  whitespace();
  value(0);
  whitespace();
  if (index !== text.length) invalid();
}

export function parseStrictJsonBytes(bytes) {
  try {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 ||
      (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    ) {
      return invalid();
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    validateJsonWithoutDuplicateKeys(text);
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof StrictJsonValidationError) throw error;
    return invalid();
  }
}
