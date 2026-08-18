function sortObjectKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeysDeep);
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;

    return Object.fromEntries(
      Object.keys(source)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .map((key) => [key, sortObjectKeysDeep(source[key])]),
    );
  }

  return value;
}

/** Serializes generated contracts with stable object-key ordering and a final LF. */
export function serializeDeterministically(value: unknown): string {
  return `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;
}
