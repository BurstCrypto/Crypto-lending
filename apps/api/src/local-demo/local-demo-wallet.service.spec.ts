import { createPublicKey, verify as verifyNodeSignature } from 'node:crypto';

import { parseAccountId } from '../accounts/domain/account-profile';
import type {
  IssuedWalletOwnershipChallenge,
  RegisteredWalletResult,
  WalletRegistrationService,
} from '../wallets/application/wallet-registration.service';
import type { LocalDemoRuntimeConfig } from './local-demo-runtime.config';
import {
  LocalDemoUnavailableError,
  LocalDemoWalletRequestError,
  LocalDemoWalletService,
  type ConnectLocalDemoWalletInput,
} from './local-demo-wallet.service';

const ACCOUNT_A = parseAccountId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const ACCOUNT_B = parseAccountId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const CORRELATION_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CORRELATION_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REGISTERED_AT = new Date('2026-08-24T20:00:00.000Z');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const ENABLED_CONFIG: LocalDemoRuntimeConfig = Object.freeze({
  mode: 'enabled',
  apiHost: '127.0.0.1',
  publicOrigin: 'http://127.0.0.1:3000',
});

type WalletRegistrationBoundary = Pick<WalletRegistrationService, 'issueChallenge' | 'submitProof'>;

interface IssuedRecord {
  readonly challenge: IssuedWalletOwnershipChallenge;
  readonly address: string;
  readonly chainId: string;
  readonly walletId: string;
}

interface ServiceFixture {
  readonly service: LocalDemoWalletService;
  readonly wallets: jest.Mocked<WalletRegistrationBoundary>;
  readonly issued: Map<string, IssuedRecord>;
}

function challengeId(sequence: number): string {
  return `10000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

function walletId(sequence: number): string {
  return `20000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

function serviceFixture(config: LocalDemoRuntimeConfig = ENABLED_CONFIG): ServiceFixture {
  let sequence = 0;
  const issued = new Map<string, IssuedRecord>();
  const wallets: jest.Mocked<WalletRegistrationBoundary> = {
    issueChallenge: jest.fn(),
    submitProof: jest.fn(),
  };

  wallets.issueChallenge.mockImplementation(async (input) => {
    sequence += 1;
    const id = challengeId(sequence);
    const registeredWalletId = walletId(sequence);
    const evm = input.chainId.startsWith('eip155:');
    const address = evm ? input.address.toLowerCase() : input.address;
    const challenge = {
      version: 1,
      challengeId: id,
      messageFormat: evm ? 'SIWE' : 'SIWS',
      chainId: input.chainId,
      address,
      accountId: `${input.chainId}:${address}`,
      message: `Synthetic ownership challenge ${id}`,
      expiresAt: '2026-08-24T20:05:00.000Z',
      registryEnvironment: 'TESTNET',
      registryVersion: 1,
      registryFingerprintSha256: 'ab'.repeat(32),
    } as IssuedWalletOwnershipChallenge;
    issued.set(id, {
      challenge,
      address,
      chainId: input.chainId,
      walletId: registeredWalletId,
    });
    return challenge;
  });

  wallets.submitProof.mockImplementation(async (input) => {
    const record = issued.get(input.proof.challengeId);
    if (record === undefined) throw new Error('fixture challenge missing');
    return {
      status: 'registered',
      walletId: record.walletId,
      chainId: record.chainId,
      address: record.address,
      registeredAt: new Date(REGISTERED_AT),
      registryEnvironment: 'TESTNET',
      registryVersion: 1,
      registryFingerprintSha256: 'ab'.repeat(32),
    } satisfies RegisteredWalletResult;
  });

  return {
    service: new LocalDemoWalletService(wallets as unknown as WalletRegistrationService, config),
    wallets,
    issued,
  };
}

function connectInput(
  overrides: Partial<ConnectLocalDemoWalletInput> = {},
): ConnectLocalDemoWalletInput {
  return {
    accountId: ACCOUNT_A,
    namespace: 'EVM',
    correlationId: CORRELATION_A,
    ...overrides,
  };
}

describe('LocalDemoWalletService', () => {
  it('fails closed for disabled or malformed runtime configuration', async () => {
    const disabled = serviceFixture(Object.freeze({ mode: 'disabled' }));
    await expect(disabled.service.connect(connectInput())).rejects.toBeInstanceOf(
      LocalDemoUnavailableError,
    );
    expect(() => disabled.service.list(ACCOUNT_A)).toThrow(LocalDemoUnavailableError);
    expect(() => disabled.service.disconnect(ACCOUNT_A, walletId(1))).toThrow(
      LocalDemoUnavailableError,
    );
    expect(() => disabled.service.reset(ACCOUNT_A)).toThrow(LocalDemoUnavailableError);
    expect(disabled.wallets.issueChallenge).not.toHaveBeenCalled();

    const malformed = serviceFixture({
      mode: 'enabled',
      apiHost: '0.0.0.0',
      publicOrigin: 'http://127.0.0.1:3000',
    } as unknown as LocalDemoRuntimeConfig);
    await expect(malformed.service.connect(connectInput())).rejects.toBeInstanceOf(
      LocalDemoUnavailableError,
    );
    expect(malformed.wallets.issueChallenge).not.toHaveBeenCalled();
  });

  it('generates an ephemeral EVM signer and sequences issue, sign, and submit', async () => {
    const fixture = serviceFixture();
    const connection = await fixture.service.connect(connectInput());

    expect(fixture.wallets.issueChallenge).toHaveBeenCalledWith({
      accountId: ACCOUNT_A,
      chainId: 'eip155:11155111',
      address: expect.stringMatching(/^0x[0-9A-Fa-f]{40}$/u),
      correlationId: CORRELATION_A,
    });
    const issueOrder = fixture.wallets.issueChallenge.mock.invocationCallOrder[0];
    const submitOrder = fixture.wallets.submitProof.mock.invocationCallOrder[0];
    expect(issueOrder).toBeLessThan(submitOrder as number);

    const submission = fixture.wallets.submitProof.mock.calls[0]?.[0];
    expect(submission).toMatchObject({
      accountId: ACCOUNT_A,
      correlationId: CORRELATION_A,
      proof: {
        kind: 'EVM_EIP191_EOA',
        challengeId: challengeId(1),
        message: `Synthetic ownership challenge ${challengeId(1)}`,
        signature: expect.stringMatching(/^0x[0-9a-f]{130}$/u),
      },
    });
    const signature = submission?.proof.kind === 'EVM_EIP191_EOA' ? submission.proof.signature : '';

    expect(connection).toEqual({
      connectionId: walletId(1),
      walletId: walletId(1),
      label: 'Synthetic EVM wallet',
      namespace: 'EVM',
      chainId: 'eip155:11155111',
      address: expect.stringMatching(/^0x[0-9a-f]{40}$/u),
      registeredAt: REGISTERED_AT.toISOString(),
    });
    expect(Object.isFrozen(connection)).toBe(true);
    expect(Object.keys(connection)).toEqual([
      'connectionId',
      'walletId',
      'label',
      'namespace',
      'chainId',
      'address',
      'registeredAt',
    ]);
    expect(JSON.stringify(connection)).not.toContain('Synthetic ownership challenge');
    expect(JSON.stringify(connection)).not.toContain(signature);
    expect(Object.isFrozen(fixture.service.list(ACCOUNT_A))).toBe(true);
    expect(fixture.service.list(ACCOUNT_A)).toEqual([connection]);
  });

  it('generates and uses an ephemeral Solana Ed25519 key pair without returning proof material', async () => {
    const fixture = serviceFixture();
    const connection = await fixture.service.connect(
      connectInput({ namespace: 'SOLANA', correlationId: CORRELATION_B }),
    );

    expect(fixture.wallets.issueChallenge).toHaveBeenCalledWith({
      accountId: ACCOUNT_A,
      chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      address: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u),
      correlationId: CORRELATION_B,
    });
    const submission = fixture.wallets.submitProof.mock.calls[0]?.[0];
    expect(submission?.proof.kind).toBe('SOLANA_ED25519');
    if (submission?.proof.kind !== 'SOLANA_ED25519') {
      throw new Error('expected Solana proof fixture');
    }
    expect(submission.proof.publicKey).toHaveLength(32);
    expect(submission.proof.signature).toHaveLength(64);
    expect(Buffer.from(submission.proof.signedMessage).toString('utf8')).toBe(
      `Synthetic ownership challenge ${challengeId(1)}`,
    );
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(submission.proof.publicKey)]),
      format: 'der',
      type: 'spki',
    });
    expect(
      verifyNodeSignature(
        null,
        Buffer.from(submission.proof.signedMessage),
        publicKey,
        Buffer.from(submission.proof.signature),
      ),
    ).toBe(true);

    expect(connection).toEqual({
      connectionId: walletId(1),
      walletId: walletId(1),
      label: 'Synthetic Solana wallet',
      namespace: 'SOLANA',
      chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      address: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/u),
      registeredAt: REGISTERED_AT.toISOString(),
    });
    expect(connection).not.toHaveProperty('privateKey');
    expect(connection).not.toHaveProperty('publicKey');
    expect(connection).not.toHaveProperty('signature');
    expect(connection).not.toHaveProperty('challenge');
  });

  it('coalesces concurrent and repeated connects for one account and namespace', async () => {
    const fixture = serviceFixture();
    const input = connectInput();
    const [first, concurrent] = await Promise.all([
      fixture.service.connect(input),
      fixture.service.connect(input),
    ]);
    const repeated = await fixture.service.connect({ ...input, correlationId: CORRELATION_B });

    expect(concurrent).toBe(first);
    expect(repeated).toBe(first);
    expect(fixture.wallets.issueChallenge).toHaveBeenCalledTimes(1);
    expect(fixture.wallets.submitProof).toHaveBeenCalledTimes(1);
    expect(fixture.service.list(ACCOUNT_A)).toEqual([first]);
  });

  it('isolates catalogs and lifecycle operations by authenticated account', async () => {
    const fixture = serviceFixture();
    const accountA = await fixture.service.connect(connectInput());
    const accountB = await fixture.service.connect(
      connectInput({
        accountId: ACCOUNT_B,
        namespace: 'SOLANA',
        correlationId: CORRELATION_B,
      }),
    );

    expect(fixture.service.list(ACCOUNT_A)).toEqual([accountA]);
    expect(fixture.service.list(ACCOUNT_B)).toEqual([accountB]);
    expect(fixture.service.disconnect(ACCOUNT_A, accountB.connectionId)).toBe(false);
    expect(fixture.service.list(ACCOUNT_B)).toEqual([accountB]);
    expect(fixture.service.disconnect(ACCOUNT_A, accountA.connectionId)).toBe(true);
    expect(fixture.service.disconnect(ACCOUNT_A, accountA.connectionId)).toBe(false);
    expect(fixture.service.list(ACCOUNT_A)).toEqual([]);

    fixture.service.reset(ACCOUNT_B);
    fixture.service.reset(ACCOUNT_B);
    expect(fixture.service.list(ACCOUNT_B)).toEqual([]);
  });

  it('rejects unknown namespaces and malformed identifiers before generating a key', async () => {
    const fixture = serviceFixture();
    await expect(
      fixture.service.connect(connectInput({ namespace: 'BITCOIN' as never })),
    ).rejects.toBeInstanceOf(LocalDemoWalletRequestError);
    await expect(
      fixture.service.connect(connectInput({ correlationId: 'not-a-correlation-id' })),
    ).rejects.toBeInstanceOf(LocalDemoWalletRequestError);
    expect(() => fixture.service.list('not-an-account' as never)).toThrow(
      LocalDemoWalletRequestError,
    );
    expect(() => fixture.service.disconnect(ACCOUNT_A, 'not-a-connection')).toThrow(
      LocalDemoWalletRequestError,
    );
    expect(fixture.wallets.issueChallenge).not.toHaveBeenCalled();
    expect(fixture.wallets.submitProof).not.toHaveBeenCalled();
  });

  it('refuses to sign a mismatched or non-testnet challenge', async () => {
    const fixture = serviceFixture();
    const legitimate = await fixture.wallets.issueChallenge({
      accountId: ACCOUNT_A,
      chainId: 'eip155:11155111',
      address: '0x1111111111111111111111111111111111111111',
      correlationId: CORRELATION_A,
    });
    fixture.wallets.issueChallenge.mockClear();
    fixture.wallets.issueChallenge.mockResolvedValueOnce({
      ...legitimate,
      registryEnvironment: 'MAINNET',
    });

    await expect(fixture.service.connect(connectInput())).rejects.toBeInstanceOf(
      LocalDemoUnavailableError,
    );
    expect(fixture.wallets.submitProof).not.toHaveBeenCalled();
    expect(fixture.service.list(ACCOUNT_A)).toEqual([]);
  });
});
