import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  normalizePublicTestnetAccount,
  parsePublicTestnetExecutionIntent,
  parsePublicTestnetSubmissionResult,
  parsePublicTestnetTransactionSignature,
  publicTestnetExplorerTransactionUrl,
  publicTestnetWalletTransaction,
  PublicTestnetExecutionValidationError,
  PUBLIC_TESTNET_CHAIN_ID,
  PUBLIC_TESTNET_FAUCET_URL,
  validatePublicTestnetExecutionRequest,
} from '../lib/public-testnet/public-testnet-execution';
import {
  PUBLIC_TESTNET_ACCOUNT,
  PUBLIC_TESTNET_DESTINATION_COLLATERAL_ACCOUNT,
  PUBLIC_TESTNET_INTENT_ID,
  PUBLIC_TESTNET_NOW,
  PUBLIC_TESTNET_SIGNATURE,
  PUBLIC_TESTNET_SOURCE_LIQUIDITY_ACCOUNT,
  publicTestnetIntent,
  publicTestnetIntentResponse,
  publicTestnetRequest,
  publicTestnetSubmissionResponse,
  serializePublicTestnetTransaction,
} from './public-testnet.fixtures';

function transactionRecord(response: Record<string, unknown>): Record<string, unknown> {
  return response.transaction as Record<string, unknown>;
}

function parse(response: Record<string, unknown>, now = PUBLIC_TESTNET_NOW) {
  return parsePublicTestnetExecutionIntent(response, publicTestnetRequest(), now);
}

describe('public testnet execution validation', () => {
  it('accepts only the exact reviewed Solana Devnet intent and derives the wallet request', () => {
    const intent = publicTestnetIntent();

    expect(intent.chainId).toBe(PUBLIC_TESTNET_CHAIN_ID);
    expect(intent.proof).toEqual({
      kind: 'SINGLE_TESTNET_PROOF_POSITION',
      amountAtomic: '10000000',
      assetSymbol: 'SOL',
      assetDecimals: 9,
      notFullBlend: true,
    });
    expect(intent.transaction.sourceLiquidityAccount).toBe(PUBLIC_TESTNET_SOURCE_LIQUIDITY_ACCOUNT);
    expect(intent.transaction.destinationCollateralAccount).toBe(
      PUBLIC_TESTNET_DESTINATION_COLLATERAL_ACCOUNT,
    );

    const request = publicTestnetWalletTransaction(intent);
    expect(request.transactionVersion).toBe('legacy');
    expect(request.minContextSlot).toBe(400000000);
    expect(Transaction.from(request.serializedTransaction).instructions).toHaveLength(6);
  });

  it('rejects extra request fields, a non-balanced selection, or a different chain', () => {
    expect(() =>
      validatePublicTestnetExecutionRequest({
        ...publicTestnetRequest(),
        chainId: 'solana:mainnet' as typeof PUBLIC_TESTNET_CHAIN_ID,
      }),
    ).toThrow(PublicTestnetExecutionValidationError);
    expect(() =>
      validatePublicTestnetExecutionRequest({
        ...publicTestnetRequest(),
        selection: { ...publicTestnetRequest().selection, presetId: 'YIELD' as 'BALANCED' },
      }),
    ).toThrow(PublicTestnetExecutionValidationError);
    expect(() =>
      validatePublicTestnetExecutionRequest(
        Object.assign(publicTestnetRequest(), { unexpected: true }),
      ),
    ).toThrow(PublicTestnetExecutionValidationError);
  });

  it('normalizes a canonical Solana account and rejects zero or malformed keys', () => {
    expect(normalizePublicTestnetAccount(PUBLIC_TESTNET_ACCOUNT)).toBe(PUBLIC_TESTNET_ACCOUNT);
    expect(() => normalizePublicTestnetAccount('11111111111111111111111111111111')).toThrow(
      PublicTestnetExecutionValidationError,
    );
    expect(() => normalizePublicTestnetAccount('not-base58')).toThrow(
      PublicTestnetExecutionValidationError,
    );
  });

  it('rejects a reordered or additional instruction', () => {
    const reordered = publicTestnetIntentResponse();
    transactionRecord(reordered).serializedTransactionBase64 = serializePublicTestnetTransaction(
      (transaction) => {
        const first = transaction.instructions[0];
        const second = transaction.instructions[1];
        if (first !== undefined && second !== undefined) {
          transaction.instructions[0] = second;
          transaction.instructions[1] = first;
        }
      },
    );
    expect(() => parse(reordered)).toThrow(PublicTestnetExecutionValidationError);

    const additional = publicTestnetIntentResponse();
    transactionRecord(additional).serializedTransactionBase64 = serializePublicTestnetTransaction(
      (transaction) => {
        const first = transaction.instructions[0];
        if (first !== undefined) transaction.instructions.push(first);
      },
    );
    expect(() => parse(additional)).toThrow(PublicTestnetExecutionValidationError);
  });

  it('requires the exact per-intent memo as the first instruction', () => {
    const wrongMemo = publicTestnetIntentResponse();
    transactionRecord(wrongMemo).serializedTransactionBase64 = serializePublicTestnetTransaction(
      (transaction) => {
        transaction.instructions[0]!.data = Buffer.from(
          'crypto-lending:devnet-proof:v1:22222222-2222-4222-8222-222222222222',
          'utf8',
        );
      },
    );
    expect(() => parse(wrongMemo)).toThrow(PublicTestnetExecutionValidationError);

    const memoKeys = publicTestnetIntentResponse();
    transactionRecord(memoKeys).serializedTransactionBase64 = serializePublicTestnetTransaction(
      (transaction) => {
        transaction.instructions[0]!.keys = [
          { pubkey: transaction.feePayer!, isSigner: true, isWritable: true },
        ];
      },
    );
    expect(() => parse(memoKeys)).toThrow(PublicTestnetExecutionValidationError);
  });

  it('rejects a transfer other than exactly 10,000,000 lamports', () => {
    const response = publicTestnetIntentResponse();
    transactionRecord(response).serializedTransactionBase64 = serializePublicTestnetTransaction(
      (transaction) => {
        transaction.instructions[2] = SystemProgram.transfer({
          fromPubkey: transaction.feePayer!,
          toPubkey: transaction.instructions[2]!.keys[1]!.pubkey,
          lamports: 10_000_001,
        });
      },
    );
    expect(() => parse(response)).toThrow(PublicTestnetExecutionValidationError);
  });

  it('rejects mutations to SyncNative, ATA creation, or the Save deposit', () => {
    for (const instructionIndex of [1, 3, 5]) {
      const response = publicTestnetIntentResponse();
      transactionRecord(response).serializedTransactionBase64 = serializePublicTestnetTransaction(
        (transaction) => {
          transaction.instructions[instructionIndex]!.data = Buffer.from([99]);
        },
      );
      expect(() => parse(response)).toThrow(PublicTestnetExecutionValidationError);
    }
  });

  it('rejects signed server payloads and mismatched transaction metadata', () => {
    const signed = publicTestnetIntentResponse();
    transactionRecord(signed).serializedTransactionBase64 = serializePublicTestnetTransaction(
      (transaction) => {
        transaction.signatures = [
          {
            publicKey: new PublicKey(PUBLIC_TESTNET_ACCOUNT),
            signature: Buffer.alloc(64, 7),
          },
        ];
      },
    );
    expect(() => parse(signed)).toThrow(PublicTestnetExecutionValidationError);

    const wrongSource = publicTestnetIntentResponse();
    transactionRecord(wrongSource).sourceLiquidityAccount = PUBLIC_TESTNET_ACCOUNT;
    expect(() => parse(wrongSource)).toThrow(PublicTestnetExecutionValidationError);
  });

  it('rejects stale, excessively long, and expanded intent envelopes', () => {
    const expired = publicTestnetIntentResponse();
    expired.expiresAt = '2026-08-27T11:59:00.000Z';
    expect(() => parse(expired)).toThrow(PublicTestnetExecutionValidationError);

    const tooLong = publicTestnetIntentResponse();
    tooLong.expiresAt = '2026-08-27T12:30:01.000Z';
    expect(() => parse(tooLong)).toThrow(PublicTestnetExecutionValidationError);

    expect(() => parse({ ...publicTestnetIntentResponse(), debug: true })).toThrow(
      PublicTestnetExecutionValidationError,
    );

    const shortEvidenceWindow = publicTestnetIntentResponse();
    shortEvidenceWindow.evidenceExpiresAt = shortEvidenceWindow.expiresAt;
    expect(() => parse(shortEvidenceWindow)).toThrow(PublicTestnetExecutionValidationError);

    const excessiveEvidenceWindow = publicTestnetIntentResponse();
    excessiveEvidenceWindow.evidenceExpiresAt = '2026-08-27T12:10:31.000Z';
    expect(() => parse(excessiveEvidenceWindow)).toThrow(PublicTestnetExecutionValidationError);
  });

  it('enforces the 0.02 SOL funding threshold and official faucet', () => {
    expect(publicTestnetIntent('READY').fundingReadiness.nativeBalanceLamports).toBe('20000000');
    expect(publicTestnetIntent('NEEDS_DEVNET_SOL').fundingReadiness.nativeBalanceLamports).toBe(
      '19999999',
    );

    const inconsistent = publicTestnetIntentResponse('NEEDS_DEVNET_SOL');
    (inconsistent.fundingReadiness as Record<string, unknown>).nativeBalanceLamports = '20000000';
    expect(() => parse(inconsistent)).toThrow(PublicTestnetExecutionValidationError);

    const wrongFaucet = publicTestnetIntentResponse();
    (wrongFaucet.fundingReadiness as Record<string, unknown>).faucetUrl =
      'https://example.invalid/';
    expect(() => parse(wrongFaucet)).toThrow(PublicTestnetExecutionValidationError);
    expect(PUBLIC_TESTNET_FAUCET_URL).toBe('https://faucet.solana.com/');
  });

  it('accepts exact pending and verified submission observations', () => {
    const pending = parsePublicTestnetSubmissionResult(publicTestnetSubmissionResponse('PENDING'), {
      intentId: PUBLIC_TESTNET_INTENT_ID,
      signature: PUBLIC_TESTNET_SIGNATURE,
    });
    expect(pending.transaction.slot).toBeNull();
    expect(pending.position.collateralBalanceAfterAtomic).toBeNull();

    const verified = parsePublicTestnetSubmissionResult(
      publicTestnetSubmissionResponse('VERIFIED'),
      { intentId: PUBLIC_TESTNET_INTENT_ID, signature: PUBLIC_TESTNET_SIGNATURE },
    );
    expect(verified.status).toBe('VERIFIED');
    expect(verified.position.increaseAtomic).toBe('10000000');
  });

  it('rejects inconsistent pending and verified submission states', () => {
    const pending = publicTestnetSubmissionResponse('PENDING');
    (pending.transaction as Record<string, unknown>).slot = '400000010';
    expect(() =>
      parsePublicTestnetSubmissionResult(pending, {
        intentId: PUBLIC_TESTNET_INTENT_ID,
        signature: PUBLIC_TESTNET_SIGNATURE,
      }),
    ).toThrow(PublicTestnetExecutionValidationError);

    const verified = publicTestnetSubmissionResponse('VERIFIED');
    (verified.position as Record<string, unknown>).increaseAtomic = '9999999';
    expect(() =>
      parsePublicTestnetSubmissionResult(verified, {
        intentId: PUBLIC_TESTNET_INTENT_ID,
        signature: PUBLIC_TESTNET_SIGNATURE,
      }),
    ).toThrow(PublicTestnetExecutionValidationError);
  });

  it('validates 64-byte signatures and constructs only a Devnet explorer URL', () => {
    expect(parsePublicTestnetTransactionSignature(PUBLIC_TESTNET_SIGNATURE)).toBe(
      PUBLIC_TESTNET_SIGNATURE,
    );
    expect(publicTestnetExplorerTransactionUrl(PUBLIC_TESTNET_SIGNATURE)).toBe(
      `https://explorer.solana.com/tx/${PUBLIC_TESTNET_SIGNATURE}?cluster=devnet`,
    );
    expect(() => parsePublicTestnetTransactionSignature('1111')).toThrow(
      PublicTestnetExecutionValidationError,
    );
  });
});
