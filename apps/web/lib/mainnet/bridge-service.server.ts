import { randomUUID } from 'node:crypto';
import {
  AddressLookupTableProgram, ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { encodeFunctionData, verifyTypedData, type Address, type Hex } from 'viem';

import { createSourceBridgePlan, ETHEREUM, SOLANA, BRIDGE_INTENT_TYPES, ethereumBridgeIntent } from '../../../../onchain/src/source-plan';
import { serializeSourcePlan, restoreSourcePlan, verifyEmittedCctpMessage } from '../../../../onchain/src/plan-storage';
import { getCircleStandardFee, pollCircleAttestation } from '../../../../onchain/src/circle-client';
import { prepareEthereumSourceBridge, prepareEthereumAaveSupply } from '../../../../onchain/src/ethereum-source';
import { prepareSolanaSourceBridge } from '../../../../onchain/src/solana-source';
import { bindCctpMintMessage, prepareEthereumCctpMint, prepareSolanaCctpMint, solanaCctpMintInstructions, type BoundCctpMessage } from '../../../../onchain/src/cctp-mint';
import { prepareEthereumCctpMintAndSupply, prepareSolanaCctpMintAndSupply, kaminoUsdcSupplyInstructions, KAMINO_COLLATERAL_MINT } from '../../../../onchain/src/destination-lending';
import { MAINNET_TEST as P, TOKEN_ABI, fail, usdcAmount } from './policy';
import { BridgeJournal, fingerprint } from './bridge-journal.server';
import { BridgeEthereum } from './bridge-ethereum.server';
import { BridgeSolana } from './bridge-solana.server';
import { LocalLendingService } from './lending.server';
import { LocalSmartLendingService } from './smart-lending.server';
import { parseBridgeConfig, missingConfigurationStore, type WalletConfigurationStore } from './wallet-config';
import { CIRCLE_ETHEREUM_MESSENGER, CIRCLE_ETHEREUM_TRANSMITTER, completedStep, hasBothWallets, isDirectLendingStep, type BridgeConfig, type LocalWalletConfig, type BridgeRecord, type BridgeStep, type BridgeStepKind } from './bridge-types';
import { isLendingProvider, MARKETS, type LendingProvider } from '../lending/markets';

const SOLANA_COST_LIMIT = 20_000_000n;
const SOLANA_RESERVE = 10_000_000n;
const deployment = (config: BridgeConfig) => ({ ethereumTokenMessenger: CIRCLE_ETHEREUM_MESSENGER,
  ethereumMessageTransmitter: CIRCLE_ETHEREUM_TRANSMITTER, ethereumSourceRouter: config.ethereumSourceRouter! });
const restore = (bridge: BridgeRecord) => restoreSourcePlan(bridge.plan, { ethereum: bridge.config.ethereumTreasury, solana: bridge.config.solanaTreasury });

export class LocalBridgeService {
  readonly lending: LocalLendingService;
  readonly smartLending: LocalSmartLendingService;
  constructor(readonly journal: BridgeJournal, readonly ethereum = new BridgeEthereum(), readonly solana = new BridgeSolana(), readonly configuration: WalletConfigurationStore = missingConfigurationStore) {
    this.lending = new LocalLendingService(journal, ethereum, solana, configuration);
    this.smartLending = new LocalSmartLendingService(this);
  }

  async inspectWallets(config: LocalWalletConfig) {
    if (hasBothWallets(config)) return this.preflight(config, Boolean(config.ethereumSourceRouter && config.ethereumSupplyRouter));
    const ethereum = config.ethereumWallet ? await this.ethereum.rpc.inspect(config.ethereumWallet) : null;
    const solana = config.solanaWallet ? await this.solana.inspect({ solanaWallet: config.solanaWallet, solanaTreasury: config.solanaTreasury }) : null;
    return { ethereum: ethereum?.snapshot ?? null, solana, routersVerified: false };
  }
  async preflight(config: BridgeConfig, requireRouters = true) {
    const ethereum = await this.ethereum.rpc.inspect(config.ethereumWallet);
    const solana = await this.solana.inspect(config);
    if (requireRouters) {
      await this.ethereum.validateRouter(config, 'DEPLOY_SOURCE');
      await this.ethereum.validateRouter(config, 'DEPLOY_SUPPLY');
    }
    return { ethereum: ethereum.snapshot, solana, routersVerified: requireRouters };
  }

  async create(sourceNetwork: unknown, amount: unknown, config: BridgeConfig, smartQuoteId?: string, destinationProvider?: LendingProvider) {
    if (sourceNetwork !== ETHEREUM && sourceNetwork !== SOLANA) return fail('Choose Ethereum or Solana as the source chain.');
    if (destinationProvider && (!isLendingProvider(destinationProvider) || MARKETS[destinationProvider].network === sourceNetwork)) return fail('Choose a lending provider on the destination network.');
    if (this.journal.paused()) return fail('New source transfers are paused.');
    if (this.journal.steps().some((step) => !completedStep(step.state))) return fail('Resolve pending setup or wallet transactions before starting a bridge.');
    const principal = usdcAmount(amount);
    const checked = await this.preflight(config);
    if (BigInt(checked.ethereum.totalDebt) !== 0n) return fail('Use a dedicated Ethereum wallet with no Aave debt.');
    if (BigInt(checked.ethereum.eth) < 3_000_000_000_000_000n || BigInt(checked.solana.lamports) < 30_000_000n) return fail('Fund both destination and source gas before bridging: at least 0.003 ETH and 0.03 SOL.');
    let bridgeFee = await getCircleStandardFee({ sourceNetwork, principal });
    if (sourceNetwork === SOLANA) {
      const onchainMinimum = (principal * BigInt(checked.solana.minimumFeeBps) + 9999n) / 10_000n;
      if (onchainMinimum > bridgeFee) bridgeFee = onchainMinimum;
    }
    if (bridgeFee >= principal || bridgeFee * 100n > principal) return fail('The current Circle fee exceeds 1% of the transfer amount.');
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const plan = createSourceBridgePlan({ sourceNetwork,
      sourceWallet: sourceNetwork === ETHEREUM ? config.ethereumWallet : config.solanaWallet,
      destinationWallet: sourceNetwork === ETHEREUM ? config.solanaWallet : config.ethereumWallet,
      principal, maxBridgeFee: bridgeFee, minimumDestinationAmount: principal - bridgeFee, tier: 'FREE',
      treasuries: { ethereum: config.ethereumTreasury, solana: config.solanaTreasury }, nowSeconds, deadline: nowSeconds + 300n });
    const sourceBalance = sourceNetwork === ETHEREUM ? checked.ethereum.usdc : checked.solana.usdc;
    if (BigInt(sourceBalance) < plan.totalSourceDebit) return fail('The source wallet needs the USDC principal plus the platform fee.');
    const record: BridgeRecord = { id: plan.intentId, config, plan: serializeSourcePlan(plan), createdAt: Date.now(), revision: 0,
      status: 'CREATED', sourceTransactionId: null, emittedMessage: null, attestation: null, received: null, ...(smartQuoteId ? { smartQuoteId } : {}), ...(destinationProvider ? { destinationProvider } : {}) };
    this.journal.createBridge(record);
    return record;
  }

  quote(id: string) {
    const bridge = this.journal.bridge(id), plan = restore(bridge);
    if (bridge.status !== 'CREATED' || plan.sourceNetwork !== ETHEREUM || BigInt(Math.floor(Date.now() / 1000)) >= plan.deadline) return fail('This source quote has expired or was already submitted.');
    return { domain: { name: 'BonsaiCctpSourceRouter', version: '1', chainId: 1, verifyingContract: bridge.config.ethereumSourceRouter! },
      primaryType: 'BridgeIntent' as const, types: BRIDGE_INTENT_TYPES,
      message: Object.fromEntries(Object.entries(ethereumBridgeIntent(plan)).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])) };
  }

  private async evmStep(kind: BridgeStepKind, call: { from: Address; to?: Address; data: Hex }, bridge: BridgeRecord | null,
    evidence: Record<string, string> = {}) {
    const prepared = await this.ethereum.prepare(call, kind), now = Date.now();
    const step: BridgeStep = { id: randomUUID(), bridgeId: bridge?.id ?? null, kind, network: ETHEREUM, wallet: call.from.toLowerCase(),
      state: 'PREPARED', createdAt: now, expiresAt: Math.min(now + 120_000, kind === 'SOURCE_BURN' ? Number(restore(bridge!).deadline) * 1000 : Infinity),
      fingerprint: '', transactionId: null, ethereum: prepared.transaction, solana: null, maxNetworkCost: prepared.cost,
      sourcePrincipal: kind === 'SOURCE_BURN' ? String(bridge!.plan.principal) : '0', evidence };
    step.fingerprint = fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence });
    return this.journal.createStep(step);
  }
  private async solanaStep(kind: BridgeStepKind, tx: VersionedTransaction, lifetime: { lastValidBlockHeight: number; contextSlot: number }, bridge: BridgeRecord,
    evidence: Record<string, string> = {}) {
    const bytes = Buffer.from(tx.serialize()).toString('base64');
    await this.solana.simulate(bytes, lifetime.lastValidBlockHeight, lifetime.contextSlot);
    const now = Date.now();
    const step: BridgeStep = { id: randomUUID(), bridgeId: bridge.id, kind, network: SOLANA, wallet: bridge.config.solanaWallet,
      state: 'PREPARED', createdAt: now, expiresAt: Math.min(now + 60_000, kind === 'SOURCE_BURN' ? Number(restore(bridge).deadline) * 1000 : Infinity),
      fingerprint: '', transactionId: null, ethereum: null,
      solana: { serialized: bytes, version: tx.version, message: Buffer.from(tx.message.serialize()).toString('base64'), ...lifetime },
      maxNetworkCost: SOLANA_COST_LIMIT.toString(), sourcePrincipal: kind === 'SOURCE_BURN' ? String(bridge.plan.principal) : '0', evidence };
    step.fingerprint = fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence });
    return this.journal.createStep(step);
  }
  async deploy(config: BridgeConfig, kind: unknown) {
    if (kind !== 'DEPLOY_SOURCE' && kind !== 'DEPLOY_SUPPLY') return fail('Choose one of the two bridge routers.');
    if ((kind === 'DEPLOY_SOURCE' ? config.ethereumSourceRouter : config.ethereumSupplyRouter) !== null) return fail('That router is already configured. Verify its deployment instead.');
    const call = this.ethereum.deploymentCall(config, kind);
    return this.evmStep(kind, call, null, { config: JSON.stringify(config) });
  }
  async source(id: string, quoteSignature?: unknown) {
    const bridge = this.journal.bridge(id), plan = restore(bridge), config = bridge.config;
    if (bridge.status !== 'CREATED' || BigInt(Math.floor(Date.now() / 1000)) >= plan.deadline) return fail('The source quote expired or was submitted. An unsubmitted bridge can be cancelled to request a new quote.');
    const checked = await this.preflight(config);
    if (plan.sourceNetwork === ETHEREUM) {
      const allowance = await this.ethereum.allowance(config.ethereumWallet, config.ethereumSourceRouter!);
      if (allowance !== plan.totalSourceDebit) {
        const amount = allowance === 0n ? plan.totalSourceDebit : 0n;
        return this.evmStep(allowance === 0n ? 'SOURCE_APPROVAL' : 'SOURCE_REVOKE', {
          from: config.ethereumWallet, to: P.usdc, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: [config.ethereumSourceRouter!, amount] }),
        }, bridge, { amount: amount.toString(), spender: config.ethereumSourceRouter! });
      }
      if (typeof quoteSignature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(quoteSignature)) return { quoteRequired: true, quote: this.quote(id) };
      if (!await verifyTypedData({ address: config.ethereumWallet, domain: { name: 'BonsaiCctpSourceRouter', version: '1', chainId: 1,
        verifyingContract: config.ethereumSourceRouter! }, types: BRIDGE_INTENT_TYPES, primaryType: 'BridgeIntent',
        message: ethereumBridgeIntent(plan), signature: quoteSignature as Hex })) return fail('The local quote was not signed by the configured quote authority wallet.');
      if (BigInt(checked.ethereum.usdc) < plan.totalSourceDebit) return fail('The source USDC balance is insufficient.');
      return this.evmStep('SOURCE_BURN', prepareEthereumSourceBridge({ plan, router: config.ethereumSourceRouter!, quoteSignature: quoteSignature as Hex }), bridge);
    }
    if (BigInt(checked.solana.usdc) < plan.totalSourceDebit || BigInt(checked.solana.lamports) < SOLANA_COST_LIMIT + SOLANA_RESERVE) return fail('The Solana source wallet needs USDC including the platform fee, plus gas and rent.');
    const block = await this.solana.blockhash(checked.solana.slot);
    // This ephemeral event-account co-signer owns no user funds. Only its public
    // signature is retained; the user's wallet must sign the spending transaction.
    const event = Keypair.generate();
    const prepared = prepareSolanaSourceBridge({ plan, eventSigner: event, blockhash: block.blockhash,
      lastValidBlockHeight: block.lastValidBlockHeight, nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
      computeUnits: 1_000_000, microLamportsPerComputeUnit: 10_000n });
    const tx = VersionedTransaction.deserialize(prepared.transaction.serialize({ requireAllSignatures: false }));
    return this.solanaStep('SOURCE_BURN', tx, block, bridge, { eventAccount: event.publicKey.toBase58() });
  }
  private bound(bridge: BridgeRecord): BoundCctpMessage {
    if (!bridge.attestation || !bridge.emittedMessage || !bridge.sourceTransactionId) return fail('Verify source finality and wait for Circle attestation first.');
    verifyEmittedCctpMessage(bridge.emittedMessage, bridge.attestation.message);
    return bindCctpMintMessage({ plan: restore(bridge), deployment: deployment(bridge.config), message: bridge.attestation.message, attestation: bridge.attestation.signature });
  }
  async attestation(id: string) {
    const bridge = this.journal.bridge(id);
    if (bridge.status !== 'AWAITING_ATTESTATION') return bridge;
    const plan = restore(bridge);
    const result = await pollCircleAttestation({ plan, deployment: deployment(bridge.config), sourceTransactionId: bridge.sourceTransactionId! });
    if (result.status === 'PENDING') return bridge;
    verifyEmittedCctpMessage(bridge.emittedMessage!, result.bound.message);
    return this.journal.updateBridge({ ...bridge, status: 'READY_TO_MINT',
      attestation: { message: result.bound.message, signature: result.bound.attestation }, received: result.bound.expectedReceivedAmount.toString() });
  }
  async destination(id: string, mode: unknown) {
    if (!['mint-and-supply', 'mint-only', 'supply-only'].includes(String(mode))) return fail('Choose a destination action.');
    let bridge = this.journal.bridge(id);
    if (!['READY_TO_MINT', 'MINTED'].includes(bridge.status)) return fail('The source and attestation must be verified before destination work.');
    const bound = this.bound(bridge), config = bridge.config, plan = bound.plan;
    const provider = bridge.destinationProvider;
    if (provider && provider !== 'aave' && provider !== 'kamino') {
      if (mode === 'mint-and-supply') return fail('Receive the bridged USDC first, then review its deposit to the selected provider.');
      if (mode === 'supply-only') {
        if (bridge.status !== 'MINTED') return fail('Verify the Circle mint before lending.');
        const amount = bound.expectedReceivedAmount;
        return this.lending.prepare(config, plan.destinationNetwork, 'supply', `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, '0')}`,
          { fundingBridgeId: bridge.id, ...(bridge.smartQuoteId ? { originSmartQuoteId: bridge.smartQuoteId } : {}) }, provider);
      }
    }
    if (plan.destinationNetwork === ETHEREUM) {
      if (mode !== 'mint-only') await this.ethereum.validateRouter(config, 'DEPLOY_SUPPLY');
      const inspection = await this.ethereum.rpc.inspect(config.ethereumWallet);
      if (mode !== 'mint-only' && (BigInt(inspection.snapshot.totalDebt) !== 0n)) return fail('Use an Ethereum wallet without Aave borrowing debt for this flow.');
      const minted = await this.ethereum.minted(bound.nonce);
      if (minted && bridge.status !== 'MINTED') bridge = this.journal.updateBridge({ ...bridge, status: 'MINTED' });
      if (minted && mode === 'mint-only') return bridge;
      if (!minted && mode === 'supply-only') return fail('The original Circle mint has not completed.');
      if (minted && BigInt(inspection.snapshot.usdc) < bound.expectedReceivedAmount) return fail('The minted USDC must be available in the destination wallet before supply.');
      if (!minted && mode === 'mint-only') return this.evmStep('DESTINATION_MINT', prepareEthereumCctpMint(bound), bridge);
      const allowance = await this.ethereum.allowance(config.ethereumWallet, config.ethereumSupplyRouter!);
      if (allowance !== bound.expectedReceivedAmount) {
        const amount = allowance === 0n ? bound.expectedReceivedAmount : 0n;
        return this.evmStep(allowance === 0n ? 'DESTINATION_APPROVAL' : 'DESTINATION_REVOKE', {
          from: config.ethereumWallet, to: P.usdc, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: [config.ethereumSupplyRouter!, amount] }),
        }, bridge, { amount: amount.toString(), spender: config.ethereumSupplyRouter! });
      }
      const minimumATokens = bound.expectedReceivedAmount > 1n ? bound.expectedReceivedAmount - 1n : 1n;
      const call = minted ? prepareEthereumAaveSupply({ user: config.ethereumWallet, supplyRouter: config.ethereumSupplyRouter!, principal: bound.expectedReceivedAmount, minimumATokens })
        : prepareEthereumCctpMintAndSupply({ bound, supplyRouter: config.ethereumSupplyRouter!, minimumATokens });
      return this.evmStep(minted ? 'DESTINATION_SUPPLY' : 'DESTINATION_MINT_SUPPLY', call, bridge, { received: bound.expectedReceivedAmount.toString() });
    }
    const inspection = await this.solana.inspect(config);
    if (BigInt(inspection.lamports) < SOLANA_COST_LIMIT + SOLANA_RESERVE) return fail('The destination wallet needs SOL for gas and account rent.');
    const minted = await this.solana.minted(bound.nonce);
    if (minted && bridge.status !== 'MINTED') bridge = this.journal.updateBridge({ ...bridge, status: 'MINTED' });
    if (minted && mode === 'mint-only') return bridge;
    if (!minted && mode === 'supply-only') return fail('The original Circle mint has not completed.');
    if (minted && BigInt(inspection.usdc) < bound.expectedReceivedAmount) return fail('The minted USDC must be available before supplying to Kamino.');
    const block = await this.solana.blockhash(inspection.slot), tables = await this.solana.tables(config.solanaLookupTables, inspection.slot);
    const shared = { bound, blockhash: block.blockhash, circleFeeRecipient: new PublicKey(inspection.circleFeeRecipient), lookupTables: tables };
    let tx: VersionedTransaction;
    const kind = minted ? 'DESTINATION_SUPPLY' : mode === 'mint-only' ? 'DESTINATION_MINT' : 'DESTINATION_MINT_SUPPLY';
    try {
      tx = minted ? new VersionedTransaction(new TransactionMessage({ payerKey: new PublicKey(config.solanaWallet), recentBlockhash: block.blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
          ...kaminoUsdcSupplyInstructions({ user: new PublicKey(config.solanaWallet), principal: bound.expectedReceivedAmount })] }).compileToV0Message(tables))
        : mode === 'mint-only' ? prepareSolanaCctpMint(shared) : prepareSolanaCctpMintAndSupply({ ...shared, computeUnits: 1_200_000 });
    } catch { return fail('Create or extend the Solana destination lookup table, then review the destination transaction again.'); }
    return this.solanaStep(kind, tx, block, bridge, { received: bound.expectedReceivedAmount.toString() });
  }
  async lookup(id: string) {
    const bridge = this.journal.bridge(id), bound = this.bound(bridge), config = bridge.config;
    if (bound.plan.destinationNetwork !== SOLANA || bridge.status !== 'READY_TO_MINT') return fail('Lookup-table setup is available for an attested Solana destination.');
    const inspection = await this.solana.inspect(config), wallet = new PublicKey(config.solanaWallet);
    if (BigInt(inspection.lamports) < SOLANA_COST_LIMIT + SOLANA_RESERVE) return fail('Fund the Solana wallet for lookup-table rent and gas first.');
    const instructions = [...solanaCctpMintInstructions({ bound, circleFeeRecipient: new PublicKey(inspection.circleFeeRecipient) }),
      ...kaminoUsdcSupplyInstructions({ user: wallet, principal: bound.expectedReceivedAmount })];
    const addresses = [...new Map(instructions.flatMap((instruction) => [instruction.programId, ...instruction.keys.map((key) => key.pubkey)])
      .filter((key) => !key.equals(wallet)).map((key) => [key.toBase58(), key])).values()];
    const tables = await this.solana.tables(config.solanaLookupTables, inspection.slot);
    const existing = tables.find((table) => table.state.authority?.equals(wallet));
    const missing = addresses.filter((key) => !tables.some((table) => table.state.addresses.some((member) => member.equals(key))));
    if (missing.length === 0) return fail('The lookup table already contains the destination accounts. Review the destination transaction.');
    const [create, derived] = AddressLookupTableProgram.createLookupTable({ authority: wallet, payer: wallet, recentSlot: inspection.slot - 1 });
    const table = existing?.key ?? derived;
    const extend = AddressLookupTableProgram.extendLookupTable({ payer: wallet, authority: wallet, lookupTable: table, addresses: missing.slice(0, 20) });
    const block = await this.solana.blockhash(inspection.slot);
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: block.blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ...(existing ? [] : [create]), extend] }).compileToV0Message());
    return this.solanaStep(existing ? 'EXTEND_LOOKUP_TABLE' : 'CREATE_LOOKUP_TABLE', tx, block, bridge,
      { lookupTable: table.toBase58(), addresses: missing.slice(0, 20).map(String).join(',') });
  }

  async reserve(id: string) {
    const step = this.journal.step(id);
    if (step.state !== 'PREPARED' || step.expiresAt <= Date.now()) return fail('This review expired or was already reserved. Cancel the expired review and prepare a new one.');
    if (isDirectLendingStep(step)) {
      if (step.evidence.smartQuoteId) await this.smartLending.assertCurrent(this.configuration.read(), step.evidence.smartQuoteId);
      return this.lending.reserve(id);
    }
    if (step.fingerprint !== fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence: step.evidence })) return fail('The saved transaction fingerprint changed.');
    const config = step.bridgeId ? this.journal.bridge(step.bridgeId).config : parseBridgeConfig(this.configuration.read());
    if (step.kind === 'SOURCE_BURN' && step.bridgeId) {
      const quoteId = this.journal.bridge(step.bridgeId).smartQuoteId;
      if (quoteId) await this.smartLending.assertCurrent(config, quoteId);
    }
    if (step.network === ETHEREUM) {
      if (step.kind === 'SOURCE_BURN') await this.ethereum.validateRouter(config, 'DEPLOY_SOURCE');
      if (step.kind.startsWith('DESTINATION_') && step.kind !== 'DESTINATION_MINT') await this.ethereum.validateRouter(config, 'DEPLOY_SUPPLY');
      await this.ethereum.revalidate(step);
    } else {
      const checked = await this.solana.inspect(config);
      if (BigInt(checked.lamports) < SOLANA_COST_LIMIT + SOLANA_RESERVE) return fail('The Solana wallet needs more SOL for this transaction and its reserve.');
      await this.solana.simulate(step.solana!.serialized, step.solana!.lastValidBlockHeight, step.solana!.contextSlot);
    }
    return this.journal.reserveStep(id);
  }
  async signed(id: string, serialized: unknown) {
    const step = this.journal.step(id);
    if (step.state !== 'RESERVED' || step.network !== SOLANA || typeof serialized !== 'string') return fail('This step is not awaiting a Solana signature.');
    const signed = this.solana.verifySigned(step, serialized);
    await this.solana.simulate(serialized, step.solana!.lastValidBlockHeight, step.solana!.contextSlot);
    return this.journal.signedStep(id, signed.transactionId, signed.serialized);
  }
  async dispatchSolana(id: string) {
    const step = this.journal.step(id);
    if (step.state !== 'SIGNED' || step.network !== SOLANA) return fail('The signed transaction was already dispatched or is unavailable.');
    const serialized = this.journal.signedPayload(id);
    if (!serialized) return fail('The durable signed transaction is unavailable.');
    this.solana.verifySigned(step, serialized);
    await this.solana.simulate(serialized, step.solana!.lastValidBlockHeight, step.solana!.contextSlot);
    const dispatched = this.journal.changeStep(id, ['SIGNED'], { state: 'SUBMITTED' });
    // The browser performs one RPC send. The server never submits or retries.
    return { step: dispatched, serialized };
  }
  async submitted(id: string, transactionId: unknown) {
    const step = this.journal.step(id);
    if (!['RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED'].includes(step.state) || typeof transactionId !== 'string') return fail('This step is not awaiting a transaction result.');
    if (step.transactionId && step.transactionId !== transactionId) return fail('Keep the original transaction identity for recovery.');
    if (step.network === ETHEREUM) {
      const checked = await this.ethereum.receipt(step, transactionId);
      if (!checked.matched) return fail('Both Ethereum endpoints have not found this transaction yet. Keep the hash and check again.');
    } else if (step.transactionId !== transactionId) {
      return fail('Solana recovery must use the signature verified before browser broadcast.');
    }
    this.journal.changeStep(id, ['RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED'], { transactionId, state: 'SUBMITTED' });
    return this.reconcile(id);
  }
  async reconcile(id: string) {
    let step = this.journal.step(id);
    if (isDirectLendingStep(step)) {
      const result = await this.lending.reconcile(id);
      if (result.state !== step.state && completedStep(result.state)) this.smartLending.invalidateMarketData();
      return result;
    }
    if (!step.transactionId || ['PREPARED', 'REJECTED', 'CANCELLED'].includes(step.state)) return step;
    const bridge = step.bridgeId ? this.journal.bridge(step.bridgeId) : null;
    const result = step.network === ETHEREUM ? await this.ethereum.receipt(step, step.transactionId) : await this.solana.receipt(step, step.transactionId);
    if (result.state !== 'FINALIZED' && result.state !== 'FAILED') {
      if (completedStep(step.state)) return fail('Previously finalized evidence is no longer available. Stop and investigate this transaction.');
      return this.journal.changeStep(id, ['RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED'], { state: result.state });
    }
    if (result.state === 'FAILED') {
      if (bridge && step.kind === 'SOURCE_BURN' && bridge.status === 'SOURCE_PENDING') this.journal.updateBridge({ ...bridge, status: 'SOURCE_FAILED' });
      if (bridge && ['DESTINATION_MINT', 'DESTINATION_MINT_SUPPLY', 'DESTINATION_SUPPLY'].includes(step.kind) && bridge.status === 'DESTINATION_PENDING') {
        this.journal.updateBridge({ ...bridge, status: step.kind === 'DESTINATION_SUPPLY' ? 'MINTED' : 'READY_TO_MINT' });
      }
      return step.state === 'FAILED' ? step : this.journal.changeStep(id, ['SUBMITTED', 'SIGNED', 'CONFIRMED'], { state: 'FAILED' });
    }
    if (step.kind === 'DEPLOY_SOURCE' || step.kind === 'DEPLOY_SUPPLY') {
      if (!('contractAddress' in result) || !result.contractAddress) return fail('The router deployment address was not verified.');
      const original = JSON.parse(step.evidence.config!) as BridgeConfig, current = parseBridgeConfig(this.configuration.read());
      for (const key of ['ethereumWallet', 'solanaWallet', 'ethereumTreasury', 'solanaTreasury'] as const) {
        if (current[key] !== original[key]) return fail('Restore the original public configuration before accepting this router deployment.');
      }
      const next = { ...current, [step.kind === 'DEPLOY_SOURCE' ? 'ethereumSourceRouter' : 'ethereumSupplyRouter']: result.contractAddress };
      await this.ethereum.validateRouter(next, step.kind);
      this.configuration.write(next);
    }
    if (bridge && step.kind === 'SOURCE_BURN' && bridge.status === 'SOURCE_PENDING') {
      const plan = restore(bridge);
      let message: Hex;
      if (step.network === ETHEREUM) message = this.ethereum.sourceMessage(bridge.config, plan, result.receipt as Record<string, unknown>);
      else {
        const receipt = result.receipt as { meta: unknown };
        this.solana.verifySourceBalances(receipt.meta, plan);
        message = await this.solana.emittedMessage(step);
      }
      this.journal.updateBridge({ ...bridge, status: 'AWAITING_ATTESTATION', sourceTransactionId: step.transactionId, emittedMessage: message });
    }
    if (bridge && ['CREATE_LOOKUP_TABLE', 'EXTEND_LOOKUP_TABLE'].includes(step.kind)) {
      const table = step.evidence.lookupTable!;
      const current = parseBridgeConfig(this.configuration.read());
      if (current.solanaWallet !== bridge.config.solanaWallet) return fail('Restore the original Solana wallet configuration.');
      const keys = [...new Set([...bridge.config.solanaLookupTables, table])];
      const tables = await this.solana.tables(keys, await this.solana.chain());
      const admitted = tables.find((candidate) => candidate.key.toBase58() === table);
      if (!admitted || step.evidence.addresses!.split(',').some((key) => !admitted.state.addresses.some((member) => member.toBase58() === key))) return fail('The lookup-table addresses were not verified.');
      if (!bridge.config.solanaLookupTables.includes(table)) this.journal.updateBridge({ ...bridge, config: { ...bridge.config, solanaLookupTables: keys } });
      this.configuration.write({ ...current, solanaLookupTables: [...new Set([...current.solanaLookupTables, table])] });
    }
    if (bridge && step.kind.includes('APPROVAL') || bridge && step.kind.includes('REVOKE')) {
      const events = this.ethereum.events(result.receipt as Record<string, unknown>);
      if (!events.some((event) => event.name === 'Approval' && event.address === P.usdc &&
        String(event.args.owner).toLowerCase() === step.wallet.toLowerCase() && String(event.args.spender).toLowerCase() === step.evidence.spender &&
        event.args.value === BigInt(step.evidence.amount!))) return fail('The exact USDC approval was not found.');
    }
    if (bridge && ['DESTINATION_MINT', 'DESTINATION_MINT_SUPPLY', 'DESTINATION_SUPPLY'].includes(step.kind) && bridge.status === 'DESTINATION_PENDING') {
      const bound = this.bound(bridge);
      if (step.network === ETHEREUM) {
        const events = this.ethereum.events(result.receipt as Record<string, unknown>);
        if (step.kind === 'DESTINATION_MINT') {
          if (!events.some((e) => e.address === P.usdc && e.name === 'Transfer' && String(e.args.from).toLowerCase() === `0x${'0'.repeat(40)}` &&
            String(e.args.to).toLowerCase() === bridge.config.ethereumWallet && e.args.value === bound.expectedReceivedAmount)) return fail('The destination USDC mint was not verified.');
        } else {
          if (!events.some((e) => e.address === bridge.config.ethereumSupplyRouter && e.name === 'Supplied' &&
            String(e.args.user).toLowerCase() === bridge.config.ethereumWallet && e.args.principal === bound.expectedReceivedAmount)) return fail('The destination Aave supply was not verified.');
          const receipt = result.receipt as Record<string, unknown>;
          const balance = BigInt(await this.ethereum.call(P.aToken, encodeFunctionData({ abi: TOKEN_ABI, functionName: 'balanceOf', args: [bridge.config.ethereumWallet] }),
            { blockHash: receipt.blockHash, requireCanonical: true }));
          if (balance + 1n < bound.expectedReceivedAmount) return fail('The Aave aUSDC position was not verified.');
        }
      } else {
        const meta = (result.receipt as { meta: unknown }).meta;
        const change = this.solana.tokenChange(meta, bridge.config.solanaWallet, step.kind === 'DESTINATION_MINT' ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : KAMINO_COLLATERAL_MINT.toBase58());
        if (step.kind === 'DESTINATION_MINT' ? change !== bound.expectedReceivedAmount : change <= 0n) return fail('The destination USDC or Kamino cToken position was not verified.');
      }
      this.journal.updateBridge({ ...bridge, status: step.kind === 'DESTINATION_MINT' ? 'MINTED' : 'LENT' });
    }
    step = this.journal.step(id);
    return step.state === 'FINALIZED' ? step : this.journal.changeStep(id, ['SUBMITTED', 'SIGNED', 'CONFIRMED'], { state: 'FINALIZED' });
  }
  cancelStep(id: string) { return this.journal.changeStep(id, ['PREPARED'], { state: 'CANCELLED' }); }
  async recoverWalletRequest(id: string) {
    const step = this.lending.assertStep(this.journal.step(id));
    if (step.network !== SOLANA || step.state !== 'RESERVED' || step.transactionId || this.journal.signedPayload(id)) return fail('Use the saved transaction status to recover this request.');
    const signature = await this.solana.recoverExpiredWalletRequest(step);
    if (!signature) return this.journal.changeStep(id, ['RESERVED'], { state: 'CANCELLED' });
    this.journal.changeStep(id, ['RESERVED'], { state: 'SUBMITTED', transactionId: signature });
    return this.lending.reconcile(id);
  }
  rejected(id: string) {
    const step = this.journal.step(id);
    if (step.state !== 'RESERVED') return fail('A signed or dispatched transaction cannot be treated as a rejected prompt.');
    if (step.bridgeId && step.kind === 'SOURCE_BURN') {
      const bridge = this.journal.bridge(step.bridgeId);
      if (bridge.status === 'SOURCE_PENDING') this.journal.updateBridge({ ...bridge, status: 'SOURCE_FAILED' });
    }
    if (step.bridgeId && ['DESTINATION_MINT', 'DESTINATION_MINT_SUPPLY', 'DESTINATION_SUPPLY'].includes(step.kind)) {
      const bridge = this.journal.bridge(step.bridgeId);
      if (bridge.status === 'DESTINATION_PENDING') this.journal.updateBridge({ ...bridge, status: step.kind === 'DESTINATION_SUPPLY' ? 'MINTED' : 'READY_TO_MINT' });
    }
    return this.journal.changeStep(id, ['RESERVED'], { state: 'REJECTED' });
  }
  cancelBridge(id: string) {
    const bridge = this.journal.bridge(id);
    if (bridge.status !== 'CREATED' || this.journal.steps().some((step) => step.bridgeId === id && !completedStep(step.state))) return fail('Only a bridge with no reserved or pending source transaction can be cancelled.');
    return this.journal.updateBridge({ ...bridge, status: 'CANCELLED' });
  }
}
