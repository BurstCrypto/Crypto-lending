import {
  createLedgerCapability,
  LedgerCapabilityError,
  revealLedgerCapability,
} from './ledger-capability-resolver.port';

const POST_VALUE = '00'.repeat(32);
const REVERSE_VALUE = '11'.repeat(32);

describe('ledger capability wrapper', () => {
  it('accepts only one canonical 256-bit lowercase hexadecimal encoding', () => {
    const capability = createLedgerCapability('POST', POST_VALUE);

    expect(revealLedgerCapability(capability, 'POST')).toBe(POST_VALUE);
    expect(Object.getPrototypeOf(capability)).toBeNull();
    expect(Object.isFrozen(capability)).toBe(true);
    expect(Reflect.ownKeys(capability)).toEqual([]);
    expect(JSON.stringify(capability)).toBe('{}');

    for (const value of [
      undefined,
      null,
      '',
      '0'.repeat(63),
      '0'.repeat(65),
      'AA'.repeat(32),
      'gg'.repeat(32),
      ` ${POST_VALUE}`,
      `${POST_VALUE} `,
    ]) {
      expect(() => createLedgerCapability('POST', value)).toThrow(new LedgerCapabilityError());
    }
  });

  it('never permits a capability to cross its posting or reversal domain', () => {
    const posting = createLedgerCapability('POST', POST_VALUE);
    const reversal = createLedgerCapability('REVERSE', REVERSE_VALUE);

    expect(() => revealLedgerCapability(posting, 'REVERSE')).toThrow(new LedgerCapabilityError());
    expect(() => revealLedgerCapability(reversal, 'POST')).toThrow(new LedgerCapabilityError());
  });

  it('rejects copied, forged, accessor-bearing, and hostile proxy objects generically', () => {
    const capability = createLedgerCapability('POST', POST_VALUE);
    const getter = jest.fn(() => POST_VALUE);
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, 'value', { enumerable: false, get: getter });
    const hostile = new Proxy(Object.create(null) as object, {
      getPrototypeOf: () => {
        throw new Error(`must not leak ${POST_VALUE}`);
      },
    });

    for (const value of [{}, Object.create(null), { ...capability }, accessor, hostile]) {
      expect(() => revealLedgerCapability(value as typeof capability, 'POST')).toThrow(
        new LedgerCapabilityError(),
      );
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
