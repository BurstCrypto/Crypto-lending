import {
  BuyingPowerValidationError,
  addBuyingPowerUsdMantissas,
  normalizeBuyingPowerUsdMantissa,
  subtractBuyingPowerUsdMantissas,
  totalBuyingPowerDeductions,
  zeroBuyingPowerDeductions,
} from './buying-power';

describe('buying-power exact USD arithmetic', () => {
  it('preserves canonical scale-18 mantissas and exact addition', () => {
    const first = normalizeBuyingPowerUsdMantissa('7000000000000000000000');
    const second = normalizeBuyingPowerUsdMantissa('4000000000000000000000');

    expect(addBuyingPowerUsdMantissas([first, second])).toBe('11000000000000000000000');
  });

  it.each(['', '-1', '+1', '01', '1.0', '1e18', 1, null, '9'.repeat(97)])(
    'rejects a non-canonical or over-bound mantissa %#',
    (value) => {
      expect(() => normalizeBuyingPowerUsdMantissa(value)).toThrow(
        new BuyingPowerValidationError('INVALID_USD_MANTISSA'),
      );
    },
  );

  it('rejects an aggregate that exceeds the bounded exact representation', () => {
    const maximum = normalizeBuyingPowerUsdMantissa('9'.repeat(96));

    expect(() => addBuyingPowerUsdMantissas([maximum, maximum])).toThrow(
      new BuyingPowerValidationError('NUMERIC_LIMIT_EXCEEDED'),
    );
  });

  it('subtracts exactly and never permits negative buying power', () => {
    const gross = normalizeBuyingPowerUsdMantissa('100');
    const deduction = normalizeBuyingPowerUsdMantissa('40');

    expect(subtractBuyingPowerUsdMantissas(gross, deduction)).toBe('60');
    expect(() => subtractBuyingPowerUsdMantissas(deduction, gross)).toThrow(
      new BuyingPowerValidationError('NEGATIVE_USD_RESULT'),
    );
  });

  it('provides all five explicit zero deductions without omitting cost categories', () => {
    expect(zeroBuyingPowerDeductions()).toEqual({
      liquidity: '0',
      conversion: '0',
      slippage: '0',
      network: '0',
      routing: '0',
    });
    expect(totalBuyingPowerDeductions(zeroBuyingPowerDeductions())).toBe('0');
  });
});
