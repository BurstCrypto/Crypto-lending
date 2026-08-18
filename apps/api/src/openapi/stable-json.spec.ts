import { serializeDeterministically } from './stable-json';

describe('serializeDeterministically', () => {
  it('sorts object keys recursively while preserving array order', () => {
    const value = {
      zebra: { second: 2, first: 1 },
      alpha: [{ delta: 4, beta: 2 }, 'unchanged'],
    };

    expect(serializeDeterministically(value)).toBe(
      [
        '{',
        '  "alpha": [',
        '    {',
        '      "beta": 2,',
        '      "delta": 4',
        '    },',
        '    "unchanged"',
        '  ],',
        '  "zebra": {',
        '    "first": 1,',
        '    "second": 2',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });
});
