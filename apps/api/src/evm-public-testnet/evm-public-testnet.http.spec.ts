import {
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_POOL,
  EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX,
  EVM_PUBLIC_TESTNET_WETH_GATEWAY,
  evmPublicTestnetIntentMarker,
} from './evm-public-testnet.constants';
import {
  EVM_PUBLIC_TESTNET_INTENT_RESPONSE_SCHEMA,
  EVM_PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA,
  EvmPublicTestnetBodyError,
  parseEvmPublicTestnetIntentBody,
  parseEvmPublicTestnetIntentId,
  parseEvmPublicTestnetPositionBody,
  parseEvmPublicTestnetSubmissionBody,
} from './evm-public-testnet.http';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const INTENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HASH = `0x${'ab'.repeat(32)}`;
const BODY = Object.freeze({
  portfolioSnapshotId: 'local-demo-portfolio:0123456789abcdef0123456789abcdef',
  selection: Object.freeze({
    kind: 'PRESET' as const,
    presetId: 'BALANCED' as const,
    liquidReserveBasisPoints: 1_250,
  }),
  chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
  account: ACCOUNT,
});

describe('EVM public-testnet HTTP boundary', () => {
  it('accepts only the fixed chain, balanced preview, and canonical EVM account', () => {
    expect(parseEvmPublicTestnetIntentBody(BODY)).toEqual(BODY);
    expect(
      parseEvmPublicTestnetPositionBody({ chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT }),
    ).toEqual({ chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: ACCOUNT });
    expect(parseEvmPublicTestnetIntentId(INTENT_ID)).toBe(INTENT_ID);
  });

  it('accepts exactly a transaction hash or the empty recovery body', () => {
    expect(parseEvmPublicTestnetSubmissionBody({ transactionHash: HASH })).toEqual({
      transactionHash: HASH,
    });
    expect(parseEvmPublicTestnetSubmissionBody({})).toEqual({});
    for (const invalid of [
      { hash: HASH },
      { transactionHash: HASH, retry: true },
      { transactionHash: HASH.toUpperCase() },
      { transactionHash: `0x${'a'.repeat(63)}` },
    ]) {
      expect(() => parseEvmPublicTestnetSubmissionBody(invalid)).toThrow(EvmPublicTestnetBodyError);
    }
  });

  it('rejects alternate targets, selections, chains, zero accounts, and accessor bodies', () => {
    for (const invalid of [
      { ...BODY, pool: EVM_PUBLIC_TESTNET_POOL },
      { ...BODY, chainId: 'eip155:8453' },
      { ...BODY, account: `0x${'0'.repeat(40)}` },
      { ...BODY, selection: { ...BODY.selection, presetId: 'MORE_YIELD' } },
      { ...BODY, selection: { ...BODY.selection, liquidReserveBasisPoints: 9_501 } },
    ]) {
      expect(() => parseEvmPublicTestnetIntentBody(invalid)).toThrow(EvmPublicTestnetBodyError);
    }
    expect(() =>
      parseEvmPublicTestnetIntentBody(
        Object.defineProperty({}, 'portfolioSnapshotId', {
          enumerable: true,
          get: () => BODY.portfolioSnapshotId,
        }),
      ),
    ).toThrow(EvmPublicTestnetBodyError);
  });

  it('publishes the fixed transaction envelope and hashless recovery in OpenAPI', () => {
    expect(EVM_PUBLIC_TESTNET_SUBMISSION_BODY_SCHEMA).toEqual(
      expect.objectContaining({ oneOf: expect.any(Array) as unknown }),
    );
    expect(EVM_PUBLIC_TESTNET_INTENT_RESPONSE_SCHEMA).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          transaction: expect.objectContaining({
            properties: expect.objectContaining({
              to: { type: 'string', enum: [EVM_PUBLIC_TESTNET_WETH_GATEWAY] },
              value: { type: 'string', enum: [EVM_PUBLIC_TESTNET_PROOF_AMOUNT_HEX] },
            }) as unknown,
          }) as unknown,
        }) as unknown,
      }),
    );
    expect(evmPublicTestnetIntentMarker(INTENT_ID)).toMatch(/^0x[0-9a-f]{64}$/u);
  });
});
