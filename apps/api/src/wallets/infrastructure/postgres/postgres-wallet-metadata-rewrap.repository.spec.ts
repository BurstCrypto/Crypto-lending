import { randomBytes, randomUUID } from 'node:crypto';

import type { QueryResult } from 'pg';

import { parseAccountId } from '../../../accounts/domain/account-profile';
import type { PostgresService } from '../../../infrastructure/database/postgres.service';
import type { CompleteWalletMetadataRewrapRequest } from '../../application/ports/wallet-metadata-rewrap-repository.port';
import {
  PostgresWalletMetadataRewrapRepository,
  WalletMetadataRewrapPersistenceError,
} from './postgres-wallet-metadata-rewrap.repository';

const ACCOUNT_ID = parseAccountId(randomUUID());
const WALLET_ID = randomUUID();
const CHALLENGE_ID = randomUUID();
const COMMAND_ID = randomUUID();
const SHA256 = randomBytes(32).toString('hex');
const IV = randomBytes(12);
const TAG = randomBytes(16);
const CIPHERTEXT = randomBytes(48);

function result<Row>(rows: readonly Row[]): QueryResult<Row & Record<string, unknown>> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as (Row & Record<string, unknown>)[],
  };
}

function repositoryWith(query: jest.Mock): PostgresWalletMetadataRewrapRepository {
  return new PostgresWalletMetadataRewrapRepository({ query } as unknown as PostgresService);
}

function preparedRow(): Record<string, unknown> {
  return {
    rewrap_outcome: 'PREPARED',
    prepared_command_id: COMMAND_ID,
    prepared_account_id: ACCOUNT_ID,
    prepared_wallet_id: WALLET_ID,
    prepared_challenge_id: CHALLENGE_ID,
    prepared_chain_namespace: 'eip155',
    prepared_chain_reference: '1',
    prepared_registry_environment: 'MAINNET',
    prepared_registry_version: 1,
    prepared_registry_fingerprint_sha256: SHA256,
    prepared_address_digest_version: 1,
    prepared_address_digest: randomBytes(32),
    prepared_verification_digest_version: 2,
    prepared_verification_digest: randomBytes(32),
    prepared_address_key_version: 1,
    prepared_address_ciphertext: CIPHERTEXT,
    prepared_address_iv: IV,
    prepared_address_auth_tag: TAG,
    prepared_metadata_key_version: 1,
    prepared_metadata_ciphertext: CIPHERTEXT,
    prepared_metadata_iv: randomBytes(12),
    prepared_metadata_auth_tag: TAG,
    prepared_state_sha256: SHA256,
    prepared_expires_at: new Date('2026-09-04T18:05:00.000Z'),
  };
}

function completionRequest(): CompleteWalletMetadataRewrapRequest {
  return {
    commandId: COMMAND_ID,
    accountId: ACCOUNT_ID,
    walletId: WALLET_ID,
    targetKeyVersion: 2,
    preparedStateSha256: SHA256,
    encryptedAddress: {
      keyVersion: 2,
      ciphertext: randomBytes(48).toString('base64url'),
      iv: randomBytes(12).toString('base64url'),
      authTag: randomBytes(16).toString('base64url'),
    },
    encryptedMetadata: {
      keyVersion: 2,
      ciphertext: randomBytes(96).toString('base64url'),
      iv: randomBytes(12).toString('base64url'),
      authTag: randomBytes(16).toString('base64url'),
    },
  };
}

describe('PostgresWalletMetadataRewrapRepository', () => {
  it('maps one exact prepared row and binds the complete request without plaintext', async () => {
    const row = preparedRow();
    const query = jest
      .fn()
      .mockResolvedValueOnce(result([row]))
      .mockResolvedValueOnce(result([{ rewrap_outcome: 'COMPLETED' }]));
    const repository = repositoryWith(query);

    await expect(
      repository.prepare({
        commandId: COMMAND_ID,
        accountId: ACCOUNT_ID,
        walletId: WALLET_ID,
        targetKeyVersion: 2,
      }),
    ).resolves.toMatchObject({
      status: 'prepared',
      commandId: COMMAND_ID,
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      registeredByChallengeId: CHALLENGE_ID,
      chainId: 'eip155:1',
      preparedStateSha256: SHA256,
    });
    const request = completionRequest();
    await expect(repository.complete(request)).resolves.toEqual({ status: 'completed' });
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('prepare_wallet_metadata_rewrap'),
      [COMMAND_ID, ACCOUNT_ID, WALLET_ID, 2],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('complete_wallet_metadata_rewrap'),
      [
        COMMAND_ID,
        ACCOUNT_ID,
        WALLET_ID,
        SHA256,
        2,
        Buffer.from(request.encryptedAddress.ciphertext, 'base64url'),
        Buffer.from(request.encryptedAddress.iv, 'base64url'),
        Buffer.from(request.encryptedAddress.authTag, 'base64url'),
        2,
        Buffer.from(request.encryptedMetadata.ciphertext, 'base64url'),
        Buffer.from(request.encryptedMetadata.iv, 'base64url'),
        Buffer.from(request.encryptedMetadata.authTag, 'base64url'),
      ],
    );
    expect(JSON.stringify(query.mock.calls)).not.toContain('plaintext');
  });

  it('accepts only exact all-null terminal prepare rows', async () => {
    const nullRow = Object.fromEntries(
      Object.keys(preparedRow()).map((column) => [column, null]),
    ) as Record<string, unknown>;
    nullRow.rewrap_outcome = 'COMPLETED';
    const query = jest
      .fn()
      .mockResolvedValueOnce(result([nullRow]))
      .mockResolvedValueOnce(result([{ ...nullRow, rewrap_outcome: 'INVALID' }]))
      .mockResolvedValueOnce(
        result([{ ...nullRow, rewrap_outcome: 'COMPLETED', prepared_wallet_id: WALLET_ID }]),
      );
    const repository = repositoryWith(query);
    const scope = {
      commandId: COMMAND_ID,
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      targetKeyVersion: 2,
    } as const;

    await expect(repository.prepare(scope)).resolves.toEqual({ status: 'completed' });
    await expect(repository.prepare(scope)).resolves.toEqual({ status: 'invalid' });
    await expect(repository.prepare(scope)).rejects.toBeInstanceOf(
      WalletMetadataRewrapPersistenceError,
    );
  });

  it('rejects extra, accessor, custom-prototype, oversized, and cross-version result shapes', async () => {
    const extra = { ...preparedRow(), plaintext: 'forbidden' };
    const accessor = Object.defineProperty({ ...preparedRow() }, 'prepared_wallet_id', {
      enumerable: true,
      get: () => WALLET_ID,
    });
    const customPrototype = Object.assign(Object.create({ inherited: true }), preparedRow());
    const oversized = { ...preparedRow(), prepared_address_ciphertext: Buffer.alloc(129, 1) };
    const query = jest
      .fn()
      .mockResolvedValueOnce(result([extra]))
      .mockResolvedValueOnce(result([accessor]))
      .mockResolvedValueOnce(result([customPrototype]))
      .mockResolvedValueOnce(result([oversized]));
    const repository = repositoryWith(query);
    const scope = {
      commandId: COMMAND_ID,
      accountId: ACCOUNT_ID,
      walletId: WALLET_ID,
      targetKeyVersion: 2,
    } as const;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(repository.prepare(scope)).rejects.toBeInstanceOf(
        WalletMetadataRewrapPersistenceError,
      );
    }
    await expect(
      repository.complete({
        ...completionRequest(),
        encryptedMetadata: { ...completionRequest().encryptedMetadata, keyVersion: 3 },
      }),
    ).rejects.toBeInstanceOf(WalletMetadataRewrapPersistenceError);
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('validates count-only retirement readiness and sanitizes database failures', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(
        result([
          {
            key_version: 1,
            registered_address_count: '0',
            registered_metadata_count: '0',
            retained_challenge_count: '0',
            unexpired_challenge_count: '0',
            open_rewrap_command_count: '0',
            ready: true,
          },
        ]),
      )
      .mockResolvedValueOnce(
        result([
          {
            key_version: 1,
            registered_address_count: '0',
            registered_metadata_count: '0',
            retained_challenge_count: '1',
            unexpired_challenge_count: '2',
            open_rewrap_command_count: '0',
            ready: false,
          },
        ]),
      )
      .mockRejectedValueOnce(new Error('customer ciphertext leaked by driver'));
    const repository = repositoryWith(query);

    await expect(repository.retirementReadiness(1)).resolves.toEqual({
      keyVersion: 1,
      registeredAddressCount: 0,
      registeredMetadataCount: 0,
      retainedChallengeCount: 0,
      unexpiredChallengeCount: 0,
      openRewrapCommandCount: 0,
      ready: true,
    });
    await expect(repository.retirementReadiness(1)).rejects.toBeInstanceOf(
      WalletMetadataRewrapPersistenceError,
    );
    await expect(repository.retirementReadiness(1)).rejects.toMatchObject({
      message: 'Wallet metadata rewrap persistence operation failed',
    });
  });
});
