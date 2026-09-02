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
} from '../domain/wallet-identity';
import { isWalletRegistrationLaunchChain } from '../domain/wallet-registration-launch-policy';
import {
  MAX_ACTIVE_WALLET_REGISTRATIONS_PER_ACCOUNT,
  WALLET_REGISTRATION_REPOSITORY,
  type PrepareWalletOwnershipChallengeResult,
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
  digestWalletChallengeValue,
  digestWalletIdentity,
  digestWalletSubjectBinding,
  openWalletRegistrationValue,
  sealWalletRegistrationValue,
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

  async listActiveWallets(accountIdInput: AccountId): Promise<ActiveWalletRoster> {
    const config = this.enabledConfig();
    let accountId: AccountId;
    try {
      accountId = parseAccountId(accountIdInput);
    } catch {
      throw new WalletRegistrationUnavailableError();
    }

    let records;
    try {
      records = await this.repository.listActiveWallets({ accountId });
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
          openWalletRegistrationValue(config.metadataSealKey, sealBinding, record.encryptedAddress),
        );
        if (
          !walletRegistrationDigestEquals(
            record.addressDigest,
            digestWalletIdentity(config.identityHmacKey, chainId, address),
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
    const subjectBindingDigest = parseWalletDigest<'subject-binding'>(
      digestWalletSubjectBinding(config.challengeHmacKey, accountId, challengeId).value,
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
    const addressDigest = digestWalletIdentity(config.identityHmacKey, chainId, address);
    const sealBinding: WalletRegistrationSealBinding = {
      field: 'challenge',
      challengeId,
      accountId,
      networkId: chainId,
      addressDigest,
    };
    const challengePayload = sealWalletRegistrationValue(
      config.metadataSealKey,
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
        domainDigest: digestWalletChallengeValue(
          'domain',
          config.challengeHmacKey,
          created.record.origin,
        ),
        messageDigest: digestWalletChallengeValue(
          'message',
          config.challengeHmacKey,
          created.record.messageDigest,
        ),
        nonceDigest: digestWalletChallengeValue(
          'nonce',
          config.challengeHmacKey,
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
          openWalletRegistrationValue(config.metadataSealKey, binding, prepared.challengePayload),
        ) as unknown,
      );
      this.assertPreparedIntegrity(config, prepared, record, accountId);
    } catch {
      throw new WalletRegistrationUnavailableError();
    }

    const expectedSubjectBindingDigest = parseWalletDigest<'subject-binding'>(
      digestWalletSubjectBinding(config.challengeHmacKey, accountId, challengeId).value,
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
    const encryptedAddress = sealWalletRegistrationValue(
      config.metadataSealKey,
      { ...sealBase, field: 'address' },
      record.address,
    );
    const encryptedMetadata = sealWalletRegistrationValue(
      config.metadataSealKey,
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
        digestWalletIdentity(config.identityHmacKey, record.chainId, record.address),
      ) ||
      !walletRegistrationDigestEquals(
        prepared.domainDigest,
        digestWalletChallengeValue('domain', config.challengeHmacKey, record.origin),
      ) ||
      !walletRegistrationDigestEquals(
        prepared.messageDigest,
        digestWalletChallengeValue('message', config.challengeHmacKey, record.messageDigest),
      ) ||
      !walletRegistrationDigestEquals(
        prepared.nonceDigest,
        digestWalletChallengeValue('nonce', config.challengeHmacKey, record.nonceDigest),
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
