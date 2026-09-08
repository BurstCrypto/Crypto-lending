import { randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { parseAccountId, type AccountId } from '../../accounts/domain/account-profile';
import { supportedAssetRegistryForEnvironment } from '../../blockchain/domain/supported-asset-registry';
import { isCanonicalUuidV4 } from '../../infrastructure/logging';
import {
  createWalletOwnershipChallenge,
  parseWalletChallengeId,
  parseWalletChallengeNonce,
  parseWalletDigest,
  parseWalletOrigin,
  parseWalletOwnershipChallengeRecord,
  parseWalletUri,
  verifyWalletOwnershipProof,
  type PublicWalletOwnershipChallenge,
  type WalletOwnershipChallengeRecord,
  type WalletOwnershipProof,
  type WalletOwnershipRejectionReason,
} from '../domain/wallet-ownership-proof';
import {
  parseWalletAddress,
  parseWalletChainId,
  walletNamespaceOf,
  type WalletAddress,
  type WalletOwnershipChainId,
} from '../domain/wallet-identity';
import { isWalletRegistrationLaunchChain } from '../domain/wallet-registration-launch-policy';
import {
  MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT,
  WALLET_REGISTRATION_REPOSITORY,
  type MainnetFinancialActionRecoveryWalletPurpose,
  type PrepareWalletOwnershipChallengeResult,
  type ReadMainnetFinancialActionRecoveryWalletRequest,
  type WalletChallengeRejectionReason,
  type WalletProofScheme,
  type WalletRegistrationRepositoryPort,
  type WalletRegistryBinding,
} from './ports/wallet-registration-repository.port';
import {
  WalletOwnershipConflictError,
  WalletRegistrationRateLimitedError,
  WalletRegistrationRejectedError,
  WalletRegistrationUnavailableError,
} from './wallet-registration.errors';
import {
  WALLET_REGISTRATION_CONFIG,
  type EnabledWalletRegistrationConfig,
  type WalletRegistrationConfig,
} from '../infrastructure/config/wallet-registration.config';
import {
  activeWalletRegistrationKey,
  digestWalletChallengeValue,
  digestWalletIdentity,
  digestWalletSubjectBinding,
  openWalletRegistrationValue,
  sealWalletRegistrationValue,
  walletRegistrationKeyForVersion,
  walletRegistrationDigestEquals,
  type WalletRegistrationSealBinding,
} from '../infrastructure/crypto/wallet-registration-crypto';

export interface IssueWalletOwnershipChallengeInput {
  readonly accountId: AccountId;
  readonly chainId: string;
  readonly address: string;
  readonly correlationId: string;
}

export interface IssuedWalletOwnershipChallenge extends PublicWalletOwnershipChallenge {
  readonly registryEnvironment: 'MAINNET' | 'TESTNET';
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

export interface SubmitWalletOwnershipProofInput {
  readonly accountId: AccountId;
  readonly proof: WalletOwnershipProof;
  readonly correlationId: string;
}

export interface RemoveWalletInput {
  readonly accountId: AccountId;
  readonly walletId: string;
  readonly correlationId: string;
}

export interface RemovedWalletResult {
  /** Constant response prevents wallet existence or ownership enumeration. */
  readonly status: 'removed';
}

export interface RegisteredWalletResult {
  readonly status: 'registered' | 'already_registered';
  readonly walletId: string;
  readonly chainId: string;
  readonly address: string;
  readonly registeredAt: Date;
  readonly registryEnvironment: 'MAINNET' | 'TESTNET';
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

export const ACTIVE_WALLET_ROSTER_VERSION = 1 as const;

export interface ActiveRegisteredWallet {
  readonly walletId: string;
  readonly chainId: string;
  readonly address: string;
  readonly registeredAt: string;
  readonly registryEnvironment: 'MAINNET' | 'TESTNET';
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
}

export interface ActiveWalletRoster {
  readonly version: typeof ACTIVE_WALLET_ROSTER_VERSION;
  readonly wallets: readonly ActiveRegisteredWallet[];
}

export interface ListActiveWalletsOptions {
  /** Exact caller cancellation propagated to the durable roster read. */
  readonly signal: AbortSignal;
}

export interface ReadMainnetFinancialActionRecoveryWalletInput {
  readonly accountId: AccountId;
  readonly intentId: string;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly purpose: MainnetFinancialActionRecoveryWalletPurpose;
  readonly deadlineAt: Date;
  readonly signal: AbortSignal;
}

export interface MainnetFinancialActionRecoveryWallet {
  readonly mayAuthorizeFinancialAction: false;
  readonly mayPersist: false;
  readonly accountId: AccountId;
  readonly intentId: string;
  readonly walletId: string;
  readonly chainId: WalletOwnershipChainId;
  readonly address: WalletAddress;
  readonly lifecycleRevision: string;
  readonly lifecycleSnapshotSha256: string;
  readonly lifecycleStage:
    | 'WALLET_SIGNED_SUBMISSION_BOUND'
    | 'BROADCAST_OUTCOME_AMBIGUOUS'
    | 'RECONCILIATION_AMBIGUOUS'
    | 'FINALIZED_SUCCESS'
    | 'FINALIZED_FAILURE';
  readonly walletStatus: 'ACTIVE' | 'REVOKED';
  readonly revokedAt: string | null;
  readonly verifiedAt: string;
}

export const WALLET_REGISTRATION_CLOCK = Symbol('WALLET_REGISTRATION_CLOCK');

export interface WalletRegistrationClock {
  now(): Date;
}

export const SYSTEM_WALLET_REGISTRATION_CLOCK: WalletRegistrationClock = Object.freeze({
  now: (): Date => new Date(),
});

function exactCorrelationId(value: unknown): string {
  if (!isCanonicalUuidV4(value)) throw new WalletRegistrationRejectedError();
  return value;
}

function registryBinding(config: EnabledWalletRegistrationConfig): WalletRegistryBinding {
  const latest = supportedAssetRegistryForEnvironment(config.registryEnvironment).latest;
  return Object.freeze({
    environment: config.registryEnvironment,
    version: latest.version,
    fingerprintSha256: latest.fingerprintSha256,
  });
}

function proofSchemeFor(chainId: string): WalletProofScheme {
  return chainId.startsWith('eip155:') ? 'EVM_ERC4361_ERC191' : 'SOLANA_SIWS_SIGN_MESSAGE';
}

function sameDate(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function safeJsonRecord(record: WalletOwnershipChallengeRecord): string {
  return JSON.stringify(record);
}

function rejectionReason(reason: WalletOwnershipRejectionReason): WalletChallengeRejectionReason {
  if (reason === 'SIGNATURE_INVALID') return 'SIGNATURE_INVALID';
  if (reason === 'MESSAGE_MISMATCH') return 'WRONG_MESSAGE';
  if (reason === 'BINDING_MISMATCH') return 'WRONG_MESSAGE';
  if (reason === 'CONTRACT_VERIFICATION_UNAVAILABLE') return 'UNSUPPORTED_SCHEME';
  return 'MALFORMED_PROOF';
}

@Injectable()
export class WalletRegistrationService {
  constructor(
    @Inject(WALLET_REGISTRATION_REPOSITORY)
    private readonly repository: WalletRegistrationRepositoryPort,
    @Inject(WALLET_REGISTRATION_CONFIG)
    private readonly config: WalletRegistrationConfig,
    @Inject(WALLET_REGISTRATION_CLOCK)
    private readonly clock: WalletRegistrationClock,
  ) {}

  async listActiveWallets(
    accountIdInput: AccountId,
    options?: ListActiveWalletsOptions,
  ): Promise<ActiveWalletRoster> {
    const config = this.enabledConfig();
    let accountId: AccountId;
    try {
      accountId = parseAccountId(accountIdInput);
    } catch {
      throw new WalletRegistrationUnavailableError();
    }

    let records;
    try {
      records = await this.repository.listActiveWallets(
        options === undefined ? { accountId } : { accountId, signal: options.signal },
      );
    } catch {
      throw new WalletRegistrationUnavailableError();
    }
    if (!Array.isArray(records) || records.length > MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT) {
      throw new WalletRegistrationUnavailableError();
    }

    try {
      const latest = supportedAssetRegistryForEnvironment(config.registryEnvironment).latest;
      const identities = new Set<string>();
      const wallets = records.map((record): ActiveRegisteredWallet => {
        const chainId = parseWalletChainId(record.chainId);
        const network = latest.networks.find((candidate) => candidate.networkId === chainId);
        if (
          parseAccountId(record.accountId) !== accountId ||
          record.registry.environment !== config.registryEnvironment ||
          record.registry.version !== latest.version ||
          record.registry.fingerprintSha256 !== latest.fingerprintSha256 ||
          record.verificationAddressDigest.version !== config.identityHmacKeys.activeWriteVersion ||
          !isWalletRegistrationLaunchChain(config.registryEnvironment, chainId) ||
          !network ||
          network.activationState !== 'ACTIVE' ||
          !(record.registeredAt instanceof Date) ||
          !Number.isFinite(record.registeredAt.getTime())
        ) {
          throw new WalletRegistrationUnavailableError();
        }
        const sealBinding: WalletRegistrationSealBinding = {
          field: 'address',
          walletId: record.walletId,
          challengeId: record.registeredByChallengeId,
          accountId,
          networkId: chainId,
          addressDigest: record.addressDigest,
        };
        const address = parseWalletAddress(
          chainId,
          openWalletRegistrationValue(
            walletRegistrationKeyForVersion(
              config.metadataSealKeys,
              record.encryptedAddress.keyVersion,
            ),
            sealBinding,
            record.encryptedAddress,
          ),
        );
        if (
          !walletRegistrationDigestEquals(
            record.verificationAddressDigest,
            digestWalletIdentity(
              walletRegistrationKeyForVersion(
                config.identityHmacKeys,
                record.verificationAddressDigest.version,
              ),
              chainId,
              address,
            ),
          )
        ) {
          throw new WalletRegistrationUnavailableError();
        }
        const identity = `${chainId}\u0000${address}`;
        if (identities.has(identity)) throw new WalletRegistrationUnavailableError();
        identities.add(identity);
        return Object.freeze({
          walletId: record.walletId,
          chainId,
          address,
          registeredAt: record.registeredAt.toISOString(),
          registryEnvironment: record.registry.environment,
          registryVersion: record.registry.version,
          registryFingerprintSha256: record.registry.fingerprintSha256,
        });
      });
      wallets.sort(
        (left, right) =>
          left.chainId.localeCompare(right.chainId) ||
          left.address.localeCompare(right.address) ||
          left.walletId.localeCompare(right.walletId),
      );
      return Object.freeze({
        version: ACTIVE_WALLET_ROSTER_VERSION,
        wallets: Object.freeze(wallets),
      });
    } catch {
      throw new WalletRegistrationUnavailableError();
    }
  }

  /**
   * Resolves one immutable wallet only for an already signed-bound mainnet
   * financial-action recovery cursor. It deliberately cannot enumerate
   * revoked wallets and cannot prepare, sign, broadcast, resend, or persist.
   */
  async readMainnetFinancialActionRecoveryWallet(
    input: ReadMainnetFinancialActionRecoveryWalletInput,
  ): Promise<MainnetFinancialActionRecoveryWallet> {
    try {
      const config = this.enabledConfig();
      if (config.registryEnvironment !== 'MAINNET') throw new Error('mainnet required');
      const accountId = parseAccountId(input.accountId);
      if (
        !isCanonicalUuidV4(input.intentId) ||
        !/^[1-9][0-9]{0,18}$/u.test(input.lifecycleRevision) ||
        BigInt(input.lifecycleRevision) > 9_223_372_036_854_775_807n ||
        !/^[0-9a-f]{64}$/u.test(input.lifecycleSnapshotSha256) ||
        /^0{64}$/u.test(input.lifecycleSnapshotSha256) ||
        (input.purpose !== 'RECONCILIATION_ADMISSION' &&
          input.purpose !== 'POST_FINALITY_REVIEW') ||
        !(input.deadlineAt instanceof Date) ||
        !Number.isFinite(input.deadlineAt.getTime()) ||
        input.deadlineAt.getTime() !== Math.trunc(input.deadlineAt.getTime()) ||
        input.signal.aborted
      ) {
        throw new Error('invalid recovery request');
      }
      const startedAt = this.clock.now();
      if (
        !(startedAt instanceof Date) ||
        !Number.isFinite(startedAt.getTime()) ||
        startedAt.getTime() >= input.deadlineAt.getTime() ||
        input.deadlineAt.getTime() - startedAt.getTime() > 30_000
      ) {
        throw new Error('stale recovery request');
      }

      const repositoryRequest: ReadMainnetFinancialActionRecoveryWalletRequest = {
        accountId,
        intentId: input.intentId,
        lifecycleRevision: input.lifecycleRevision,
        lifecycleSnapshotSha256: input.lifecycleSnapshotSha256,
        purpose: input.purpose,
        deadlineAt: input.deadlineAt,
        signal: input.signal,
      };
      const record =
        await this.repository.readMainnetFinancialActionRecoveryWallet(repositoryRequest);
      const completedAt = this.clock.now();
      const latest = supportedAssetRegistryForEnvironment('MAINNET').latest;
      const permittedStage =
        input.purpose === 'RECONCILIATION_ADMISSION'
          ? record?.lifecycleStage === 'WALLET_SIGNED_SUBMISSION_BOUND' ||
            record?.lifecycleStage === 'BROADCAST_OUTCOME_AMBIGUOUS' ||
            record?.lifecycleStage === 'RECONCILIATION_AMBIGUOUS'
          : record?.lifecycleStage === 'FINALIZED_SUCCESS' ||
            record?.lifecycleStage === 'FINALIZED_FAILURE';
      if (
        record === null ||
        input.signal.aborted ||
        !(completedAt instanceof Date) ||
        !Number.isFinite(completedAt.getTime()) ||
        completedAt.getTime() < startedAt.getTime() ||
        completedAt.getTime() >= input.deadlineAt.getTime() ||
        record.accountId !== accountId ||
        record.intentId !== input.intentId ||
        !isCanonicalUuidV4(record.walletId) ||
        !isCanonicalUuidV4(record.registeredByChallengeId) ||
        (record.chainId !== 'eip155:1' &&
          record.chainId !== 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') ||
        record.lifecycleRevision !== input.lifecycleRevision ||
        record.lifecycleSnapshotSha256 !== input.lifecycleSnapshotSha256 ||
        !permittedStage ||
        record.registry.environment !== 'MAINNET' ||
        record.registry.version !== latest.version ||
        record.registry.fingerprintSha256 !== latest.fingerprintSha256 ||
        record.verificationAddressDigest.version !== config.identityHmacKeys.activeWriteVersion ||
        !(record.registeredAt instanceof Date) ||
        !Number.isFinite(record.registeredAt.getTime()) ||
        !(record.verifiedAt instanceof Date) ||
        !Number.isFinite(record.verifiedAt.getTime()) ||
        record.verifiedAt.getTime() < startedAt.getTime() ||
        record.verifiedAt.getTime() >= input.deadlineAt.getTime() ||
        record.registeredAt.getTime() > record.verifiedAt.getTime() ||
        (record.status !== 'ACTIVE' && record.status !== 'REVOKED') ||
        (record.status === 'ACTIVE') !== (record.revokedAt === null) ||
        (record.revokedAt !== null &&
          (!(record.revokedAt instanceof Date) ||
            !Number.isFinite(record.revokedAt.getTime()) ||
            record.revokedAt.getTime() < record.registeredAt.getTime() ||
            record.revokedAt.getTime() > record.verifiedAt.getTime()))
      ) {
        throw new Error('recovery wallet unavailable');
      }

      const sealBinding: WalletRegistrationSealBinding = {
        field: 'address',
        walletId: record.walletId,
        challengeId: record.registeredByChallengeId,
        accountId,
        networkId: record.chainId,
        addressDigest: record.addressDigest,
      };
      const address = parseWalletAddress(
        record.chainId,
        openWalletRegistrationValue(
          walletRegistrationKeyForVersion(
            config.metadataSealKeys,
            record.encryptedAddress.keyVersion,
          ),
          sealBinding,
          record.encryptedAddress,
        ),
      );
      const verifiedDigest = digestWalletIdentity(
        walletRegistrationKeyForVersion(
          config.identityHmacKeys,
          record.verificationAddressDigest.version,
        ),
        record.chainId,
        address,
      );
      if (!walletRegistrationDigestEquals(record.verificationAddressDigest, verifiedDigest)) {
        throw new Error('recovery wallet digest mismatch');
      }
      return Object.freeze({
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        accountId,
        intentId: record.intentId,
        walletId: record.walletId,
        chainId: record.chainId,
        address,
        lifecycleRevision: record.lifecycleRevision,
        lifecycleSnapshotSha256: record.lifecycleSnapshotSha256,
        lifecycleStage: record.lifecycleStage,
        walletStatus: record.status,
        revokedAt: record.revokedAt?.toISOString() ?? null,
        verifiedAt: record.verifiedAt.toISOString(),
      });
    } catch {
      throw new WalletRegistrationUnavailableError();
    }
  }

  async removeWallet(input: RemoveWalletInput): Promise<RemovedWalletResult> {
    let accountId: AccountId;
    try {
      accountId = parseAccountId(input.accountId);
      if (!isCanonicalUuidV4(input.walletId)) throw new Error('invalid wallet identifier');
      exactCorrelationId(input.correlationId);
    } catch {
      throw new WalletRegistrationRejectedError();
    }

    let result;
    try {
      result = await this.repository.revokeWallet({
        accountId,
        walletId: input.walletId,
        correlationId: input.correlationId,
      });
    } catch {
      throw new WalletRegistrationUnavailableError();
    }
    if (result.status !== 'revoked' && result.status !== 'unchanged') {
      throw new WalletRegistrationUnavailableError();
    }

    return Object.freeze({ status: 'removed' });
  }

  async issueChallenge(
    input: IssueWalletOwnershipChallengeInput,
  ): Promise<IssuedWalletOwnershipChallenge> {
    const config = this.enabledConfig();
    let accountId: AccountId;
    let chainId: ReturnType<typeof parseWalletChainId>;
    let address: ReturnType<typeof parseWalletAddress>;
    try {
      accountId = parseAccountId(input.accountId);
      chainId = parseWalletChainId(input.chainId);
      address = parseWalletAddress(chainId, input.address);
      exactCorrelationId(input.correlationId);
    } catch {
      throw new WalletRegistrationRejectedError();
    }

    const registry = registryBinding(config);
    const network = supportedAssetRegistryForEnvironment(
      config.registryEnvironment,
    ).latest.networks.find((candidate) => candidate.networkId === chainId);
    if (
      !isWalletRegistrationLaunchChain(config.registryEnvironment, chainId) ||
      !network ||
      network.activationState !== 'ACTIVE'
    ) {
      throw new WalletRegistrationRejectedError();
    }
    if (
      (walletNamespaceOf(chainId) === 'eip155' && network.identityKind !== 'EVM_CONTRACT') ||
      (walletNamespaceOf(chainId) === 'solana' && network.identityKind !== 'SOLANA_MINT')
    ) {
      throw new WalletRegistrationUnavailableError();
    }

    const challengeId = parseWalletChallengeId(randomUUID());
    const nonce = parseWalletChallengeNonce(randomBytes(32).toString('hex'));
    const challengeHmacKey = activeWalletRegistrationKey(config.challengeHmacKeys);
    const identityHmacKey = activeWalletRegistrationKey(config.identityHmacKeys);
    const metadataSealKey = activeWalletRegistrationKey(config.metadataSealKeys);
    const subjectBindingDigest = parseWalletDigest<'subject-binding'>(
      digestWalletSubjectBinding(challengeHmacKey, accountId, challengeId).value,
    );
    const issuedAt = this.clock.now();
    const expiresAt = new Date(issuedAt.getTime() + config.challengeTtlSeconds * 1_000);
    const created = createWalletOwnershipChallenge({
      challengeId,
      subjectBindingDigest,
      chainId,
      address,
      origin: parseWalletOrigin(config.publicOrigin),
      uri: parseWalletUri(`${config.publicOrigin}/`, config.publicOrigin),
      operation: 'REGISTER_WALLET',
      nonce,
      issuedAtEpochMilliseconds: issuedAt.getTime(),
      expiresAtEpochMilliseconds: expiresAt.getTime(),
    });
    const addressDigest = digestWalletIdentity(identityHmacKey, chainId, address);
    const identityDigests = Object.freeze(
      config.identityHmacKeys.keys.map((key) => digestWalletIdentity(key, chainId, address)),
    );
    const sealBinding: WalletRegistrationSealBinding = {
      field: 'challenge',
      challengeId,
      accountId,
      networkId: chainId,
      addressDigest,
    };
    const challengePayload = sealWalletRegistrationValue(
      metadataSealKey,
      sealBinding,
      safeJsonRecord(created.record),
    );

    let begun;
    try {
      begun = await this.repository.beginChallenge({
        challengeId,
        accountId,
        proofScheme: proofSchemeFor(chainId),
        chainId,
        addressDigest,
        identityDigests,
        domainDigest: digestWalletChallengeValue('domain', challengeHmacKey, created.record.origin),
        messageDigest: digestWalletChallengeValue(
          'message',
          challengeHmacKey,
          created.record.messageDigest,
        ),
        nonceDigest: digestWalletChallengeValue(
          'nonce',
          challengeHmacKey,
          created.record.nonceDigest,
        ),
        challengePayload,
        registry,
        issuedAt,
        expiresAt,
        correlationId: input.correlationId,
      });
    } catch (error) {
      if (error instanceof WalletRegistrationRateLimitedError) throw error;
      throw new WalletRegistrationUnavailableError();
    }
    if (!sameDate(begun.expiresAt, expiresAt) || begun.challengeId !== challengeId) {
      throw new WalletRegistrationUnavailableError();
    }
    return Object.freeze({
      ...created.publicChallenge,
      registryEnvironment: registry.environment,
      registryVersion: registry.version,
      registryFingerprintSha256: registry.fingerprintSha256,
    });
  }

  async submitProof(input: SubmitWalletOwnershipProofInput): Promise<RegisteredWalletResult> {
    const config = this.enabledConfig();
    let accountId: AccountId;
    let challengeId: ReturnType<typeof parseWalletChallengeId>;
    try {
      accountId = parseAccountId(input.accountId);
      challengeId = parseWalletChallengeId(input.proof.challengeId);
      exactCorrelationId(input.correlationId);
    } catch {
      throw new WalletRegistrationRejectedError();
    }

    let prepared: PrepareWalletOwnershipChallengeResult;
    try {
      prepared = await this.repository.prepareChallenge({
        challengeId,
        accountId,
        correlationId: input.correlationId,
      });
    } catch {
      throw new WalletRegistrationUnavailableError();
    }
    if (prepared.status !== 'pending') throw new WalletRegistrationRejectedError();

    let record: WalletOwnershipChallengeRecord;
    try {
      const binding: WalletRegistrationSealBinding = {
        field: 'challenge',
        challengeId,
        accountId,
        networkId: prepared.chainId,
        addressDigest: prepared.addressDigest,
      };
      record = parseWalletOwnershipChallengeRecord(
        JSON.parse(
          openWalletRegistrationValue(
            walletRegistrationKeyForVersion(
              config.metadataSealKeys,
              prepared.challengePayload.keyVersion,
            ),
            binding,
            prepared.challengePayload,
          ),
        ) as unknown,
      );
      this.assertPreparedIntegrity(config, prepared, record, accountId);
    } catch {
      throw new WalletRegistrationUnavailableError();
    }

    let challengeHmacKey;
    try {
      if (
        prepared.domainDigest.version !== prepared.messageDigest.version ||
        prepared.domainDigest.version !== prepared.nonceDigest.version
      ) {
        throw new Error('challenge digest key versions disagree');
      }
      challengeHmacKey = walletRegistrationKeyForVersion(
        config.challengeHmacKeys,
        prepared.domainDigest.version,
      );
    } catch {
      throw new WalletRegistrationUnavailableError();
    }
    const expectedSubjectBindingDigest = parseWalletDigest<'subject-binding'>(
      digestWalletSubjectBinding(challengeHmacKey, accountId, challengeId).value,
    );
    const verification = await verifyWalletOwnershipProof({
      record,
      proof: input.proof,
      expectedSubjectBindingDigest,
      expectedOrigin: parseWalletOrigin(config.publicOrigin),
      expectedOperation: 'REGISTER_WALLET',
      challengeState: 'PENDING',
      nowEpochMilliseconds: this.clock.now().getTime(),
    });
    if (verification.status !== 'VERIFIED') {
      await this.rejectPrepared(
        challengeId,
        accountId,
        input.correlationId,
        rejectionReason(verification.reason),
      );
      throw new WalletRegistrationRejectedError();
    }

    if (
      (prepared.proofScheme === 'EVM_ERC4361_ERC191' &&
        verification.proofKind !== 'EVM_EIP191_EOA') ||
      (prepared.proofScheme === 'SOLANA_SIWS_SIGN_MESSAGE' &&
        verification.proofKind !== 'SOLANA_ED25519') ||
      prepared.proofScheme === 'SOLANA_SIWS_SIGN_IN'
    ) {
      await this.rejectPrepared(challengeId, accountId, input.correlationId, 'UNSUPPORTED_SCHEME');
      throw new WalletRegistrationRejectedError();
    }

    const walletId = randomUUID();
    const sealBase = {
      walletId,
      challengeId,
      accountId,
      networkId: prepared.chainId,
      addressDigest: prepared.addressDigest,
    } as const;
    const metadataSealKey = activeWalletRegistrationKey(config.metadataSealKeys);
    const encryptedAddress = sealWalletRegistrationValue(
      metadataSealKey,
      { ...sealBase, field: 'address' },
      record.address,
    );
    const encryptedMetadata = sealWalletRegistrationValue(
      metadataSealKey,
      { ...sealBase, field: 'metadata' },
      JSON.stringify({
        schemaVersion: 1,
        proofKind: verification.proofKind,
        registryEnvironment: prepared.registry.environment,
        registryVersion: prepared.registry.version,
        registryFingerprintSha256: prepared.registry.fingerprintSha256,
      }),
    );

    let completed;
    try {
      completed = await this.repository.completeRegistration({
        challengeId,
        accountId,
        walletId,
        encryptedAddress,
        encryptedMetadata,
        correlationId: input.correlationId,
      });
    } catch {
      throw new WalletRegistrationUnavailableError();
    }
    if (completed.status === 'ownership_conflict') throw new WalletOwnershipConflictError();
    if (completed.status !== 'registered' && completed.status !== 'already_registered') {
      throw new WalletRegistrationRejectedError();
    }
    return Object.freeze({
      status: completed.status,
      walletId: completed.walletId,
      chainId: record.chainId,
      address: record.address,
      registeredAt: completed.registeredAt,
      registryEnvironment: prepared.registry.environment,
      registryVersion: prepared.registry.version,
      registryFingerprintSha256: prepared.registry.fingerprintSha256,
    });
  }

  private enabledConfig(): EnabledWalletRegistrationConfig {
    if (this.config.mode !== 'enabled') throw new WalletRegistrationUnavailableError();
    return this.config;
  }

  private assertPreparedIntegrity(
    config: EnabledWalletRegistrationConfig,
    prepared: Extract<PrepareWalletOwnershipChallengeResult, { status: 'pending' }>,
    record: WalletOwnershipChallengeRecord,
    expectedAccountId: AccountId,
  ): void {
    const latest = supportedAssetRegistryForEnvironment(config.registryEnvironment).latest;
    const currentNetwork = latest.networks.find(
      (candidate) => candidate.networkId === record.chainId,
    );
    if (
      prepared.challengeId !== record.challengeId ||
      prepared.chainId !== record.chainId ||
      prepared.accountId !== expectedAccountId ||
      prepared.registry.environment !== config.registryEnvironment ||
      prepared.registry.version !== latest.version ||
      prepared.registry.fingerprintSha256 !== latest.fingerprintSha256 ||
      !isWalletRegistrationLaunchChain(config.registryEnvironment, record.chainId) ||
      !currentNetwork ||
      currentNetwork.activationState !== 'ACTIVE' ||
      !sameDate(prepared.issuedAt, new Date(record.issuedAtEpochMilliseconds)) ||
      !sameDate(prepared.expiresAt, new Date(record.expiresAtEpochMilliseconds)) ||
      !walletRegistrationDigestEquals(
        prepared.addressDigest,
        digestWalletIdentity(
          walletRegistrationKeyForVersion(config.identityHmacKeys, prepared.addressDigest.version),
          record.chainId,
          record.address,
        ),
      ) ||
      !walletRegistrationDigestEquals(
        prepared.domainDigest,
        digestWalletChallengeValue(
          'domain',
          walletRegistrationKeyForVersion(config.challengeHmacKeys, prepared.domainDigest.version),
          record.origin,
        ),
      ) ||
      !walletRegistrationDigestEquals(
        prepared.messageDigest,
        digestWalletChallengeValue(
          'message',
          walletRegistrationKeyForVersion(config.challengeHmacKeys, prepared.messageDigest.version),
          record.messageDigest,
        ),
      ) ||
      !walletRegistrationDigestEquals(
        prepared.nonceDigest,
        digestWalletChallengeValue(
          'nonce',
          walletRegistrationKeyForVersion(config.challengeHmacKeys, prepared.nonceDigest.version),
          record.nonceDigest,
        ),
      )
    ) {
      throw new WalletRegistrationUnavailableError();
    }
  }

  private async rejectPrepared(
    challengeId: ReturnType<typeof parseWalletChallengeId>,
    accountId: AccountId,
    correlationId: string,
    reason: WalletChallengeRejectionReason,
  ): Promise<void> {
    let result;
    try {
      result = await this.repository.rejectChallenge({
        challengeId,
        accountId,
        reason,
        correlationId,
      });
    } catch {
      throw new WalletRegistrationUnavailableError();
    }
    if (result.status !== 'rejected' && result.status !== 'expired') {
      throw new WalletRegistrationRejectedError();
    }
  }
}
