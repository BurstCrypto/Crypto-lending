import {
  EvmStablecoinPositionValidationError,
  createEvmBalanceObservationId,
  createEvmBalanceSnapshotId,
  createEvmStablecoinPositionId,
  normalizeEvmAddress,
  normalizeEvmAtomicBalance,
  normalizeEvmBlockHash,
  normalizeEvmBlockNumber,
  type EvmSourceBlock,
} from './evm-stablecoin-position';

const walletAddress = normalizeEvmAddress('0x1111111111111111111111111111111111111111');
const contractAddress = normalizeEvmAddress('0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48');
const sourceBlock: EvmSourceBlock = Object.freeze({
  number: normalizeEvmBlockNumber('20765432'),
  hash: normalizeEvmBlockHash(`0x${'ab'.repeat(32)}`),
  parentHash: normalizeEvmBlockHash(`0x${'cd'.repeat(32)}`),
  selector: 'latest',
});

describe('EVM stablecoin position domain', () => {
  it('normalizes mixed-case non-zero addresses', () => {
    expect(contractAddress).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });

  it.each(['', '0x1234', `0x${'gg'.repeat(20)}`, `0x${'00'.repeat(20)}`, null, undefined])(
    'rejects an invalid EVM address %#',
    (value) => {
      expect(() => normalizeEvmAddress(value)).toThrow(
        new EvmStablecoinPositionValidationError('INVALID_EVM_ADDRESS'),
      );
    },
  );

  it.each([
    ['0', '0'],
    ['1', '1'],
    [
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    ],
  ])('preserves exact unsigned uint256 balance %s', (value, expected) => {
    expect(normalizeEvmAtomicBalance(value)).toBe(expected);
  });

  it.each([
    '-1',
    '+1',
    '01',
    '1.0',
    '1e6',
    '115792089237316195423570985008687907853269984665640564039457584007913129639936',
    1,
  ])('rejects a non-canonical or out-of-range balance %#', (value) => {
    expect(() => normalizeEvmAtomicBalance(value)).toThrow(
      new EvmStablecoinPositionValidationError('INVALID_EVM_ATOMIC_BALANCE'),
    );
  });

  it('normalizes exact block lineage values', () => {
    expect(normalizeEvmBlockNumber('0')).toBe('0');
    expect(normalizeEvmBlockHash(`0x${'AB'.repeat(32)}`)).toBe(`0x${'ab'.repeat(32)}`);
  });

  it.each(['-1', '01', '1.5', 1])('rejects an invalid block number %#', (value) => {
    expect(() => normalizeEvmBlockNumber(value)).toThrow(
      new EvmStablecoinPositionValidationError('INVALID_EVM_BLOCK_NUMBER'),
    );
  });

  it.each(['0x12', `0x${'gg'.repeat(32)}`, null])('rejects an invalid block hash %#', (value) => {
    expect(() => normalizeEvmBlockHash(value)).toThrow(
      new EvmStablecoinPositionValidationError('INVALID_EVM_BLOCK_HASH'),
    );
  });

  it('derives stable but scope-separated position, observation, and snapshot IDs', () => {
    const identity = {
      environment: 'MAINNET' as const,
      networkId: 'eip155:1' as const,
      walletAddress,
      contractAddress,
      registryVersion: 1,
      registryFingerprintSha256: 'a'.repeat(64),
    };
    const positionId = createEvmStablecoinPositionId(identity);
    const observationId = createEvmBalanceObservationId(positionId, sourceBlock);
    const snapshotId = createEvmBalanceSnapshotId(
      identity.environment,
      identity.networkId,
      identity.walletAddress,
      sourceBlock,
      identity.registryVersion,
      identity.registryFingerprintSha256,
    );

    expect(positionId).toMatch(/^[0-9a-f]{64}$/u);
    expect(observationId).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshotId).toMatch(/^[0-9a-f]{64}$/u);
    expect(new Set([positionId, observationId, snapshotId]).size).toBe(3);
    expect(createEvmStablecoinPositionId(identity)).toBe(positionId);
    expect(createEvmBalanceObservationId(positionId, sourceBlock)).toBe(observationId);
  });

  it('changes an observation ID when the source block changes without changing the position ID', () => {
    const positionId = createEvmStablecoinPositionId({
      environment: 'MAINNET',
      networkId: 'eip155:1',
      walletAddress,
      contractAddress,
      registryVersion: 1,
      registryFingerprintSha256: 'a'.repeat(64),
    });
    const nextBlock = Object.freeze({
      ...sourceBlock,
      number: normalizeEvmBlockNumber('20765433'),
      hash: normalizeEvmBlockHash(`0x${'ef'.repeat(32)}`),
    });

    expect(createEvmBalanceObservationId(positionId, nextBlock)).not.toBe(
      createEvmBalanceObservationId(positionId, sourceBlock),
    );
  });
});
