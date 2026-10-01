import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { MARKETS, SAVE, PROJECT_ZERO, JUPITER, SOL_USDC } from './markets';
import type { BridgeStep } from '../mainnet/bridge-types';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM = '11111111111111111111111111111111';
const ASSOCIATED = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE = 'ComputeBudget111111111111111111111111111111';
const fail = (): never => {
  throw new Error(
    'The Solana lending instructions do not match the reviewed market, amount, and wallet.',
  );
};
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
const u64 = (n: bigint) => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, n, true);
  return hex(bytes);
};

/** Check complete instruction data and account order independently of the server's
 * SDK. All token destinations and the account PDA derive from the signing wallet. */
export function validateSolanaLendingInstructions(step: BridgeStep, tx: VersionedTransaction) {
  const provider = step.evidence.provider,
    wallet = new PublicKey(step.wallet),
    user = wallet.toBase58();
  const deposit = step.kind === 'LENDING_SUPPLY',
    amount = BigInt(step.evidence.amount!),
    shares = BigInt(step.evidence.shares ?? '0');
  const ata = (mint: string) =>
    getAssociatedTokenAddressSync(new PublicKey(mint), wallet).toBase58();
  const usdc = ata(SOL_USDC);
  const expected: { program: string; data: string; keys: string[] }[] = [
    { program: COMPUTE, data: provider === 'kamino' ? '02801a0600' : '02c0270900', keys: [] },
    { program: COMPUTE, data: '030000000000000000', keys: [] },
  ];
  const associated = (mint: string) =>
    expected.push({
      program: ASSOCIATED,
      data: '01',
      keys: [user, ata(mint), user, mint, SYSTEM, TOKEN],
    });
  if (provider === 'kamino') {
    const program = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
      market = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
    const receiptMint = 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D',
      vault = 'Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6';
    const authority = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('lma'), new PublicKey(market).toBuffer()],
      new PublicKey(program),
    )[0].toBase58();
    associated(deposit ? receiptMint : SOL_USDC);
    expected.push({
      program,
      data:
        (deposit ? 'a9c91e7e06cd6644' : 'ea75b57db98edc1d') +
        u64(deposit ? amount : BigInt(step.evidence.collateralAmount!)),
      keys: deposit
        ? [
            user,
            MARKETS.kamino.target,
            market,
            authority,
            SOL_USDC,
            vault,
            receiptMint,
            usdc,
            ata(receiptMint),
            TOKEN,
            TOKEN,
            'Sysvar1nstructions1111111111111111111111111',
          ]
        : [
            user,
            market,
            MARKETS.kamino.target,
            authority,
            SOL_USDC,
            receiptMint,
            vault,
            ata(receiptMint),
            usdc,
            TOKEN,
            TOKEN,
            'Sysvar1nstructions1111111111111111111111111',
          ],
    });
  } else if (provider === 'save') {
    const target = MARKETS.save.target,
      authority = PublicKey.findProgramAddressSync(
        [new PublicKey(SAVE.market).toBuffer()],
        new PublicKey(SAVE.program),
      )[0].toBase58();
    if (
      step.evidence.positionAddress !== ata(SAVE.receipt) ||
      step.evidence.receiptMint !== SAVE.receipt
    )
      fail();
    associated(deposit ? SAVE.receipt : SOL_USDC);
    expected.push({
      program: SAVE.program,
      data: '03',
      keys: [
        target,
        'Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX',
        'nu11111111111111111111111111111111111111111',
        SYSTEM,
      ],
    });
    expected.push({
      program: SAVE.program,
      data: (deposit ? '04' : '05') + u64(deposit ? amount : shares),
      keys: deposit
        ? [
            usdc,
            ata(SAVE.receipt),
            target,
            SAVE.vault,
            SAVE.receipt,
            SAVE.market,
            authority,
            user,
            TOKEN,
          ]
        : [
            ata(SAVE.receipt),
            usdc,
            target,
            SAVE.receipt,
            SAVE.vault,
            SAVE.market,
            authority,
            user,
            TOKEN,
          ],
    });
  } else if (provider === 'project-0') {
    const group = PROJECT_ZERO.group,
      bank = MARKETS['project-0'].target;
    const position = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode('marginfi_account'),
        new PublicKey(group).toBuffer(),
        wallet.toBuffer(),
        new Uint8Array(2),
        new Uint8Array(2),
      ],
      new PublicKey(PROJECT_ZERO.program),
    )[0].toBase58();
    if (step.evidence.positionAddress !== position || step.evidence.receiptMint !== '') fail();
    if (deposit && step.evidence.createsPosition === 'true')
      expected.push({
        program: PROJECT_ZERO.program,
        data: '57b15b50da77f51f000000',
        keys: [group, position, user, user, 'Sysvar1nstructions1111111111111111111111111', SYSTEM],
      });
    if (!deposit) associated(SOL_USDC);
    expected.push({
      program: PROJECT_ZERO.program,
      data: deposit
        ? 'ab5eeb675240d48c' + u64(amount) + '0100'
        : '24484a13d2d2c0c0' + u64(0n) + '0101',
      keys: deposit
        ? [group, position, user, bank, usdc, '7jaiZR5Sk8hdYN9MxTpczTcwbWpb5WEoxSANuUwveuat', TOKEN]
        : [
            group,
            position,
            user,
            bank,
            usdc,
            '3uxNepDbmkDNq6JhRja5Z8QwbTrfmkKP8AKZV5chYDGG',
            '7jaiZR5Sk8hdYN9MxTpczTcwbWpb5WEoxSANuUwveuat',
            TOKEN,
          ],
    });
  } else if (provider === 'jupiter') {
    const receipt = ata(JUPITER.receipt),
      target = MARKETS.jupiter.target,
      admin = '5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6';
    if (step.evidence.positionAddress !== receipt || step.evidence.receiptMint !== JUPITER.receipt)
      fail();
    associated(deposit ? JUPITER.receipt : SOL_USDC);
    const tail = [
      '94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu',
      'Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF',
      '5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688',
      'BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB',
      ...(!deposit ? ['HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW'] : []),
      '7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z',
      'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC',
      '5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd',
      TOKEN,
      ASSOCIATED,
      SYSTEM,
    ];
    expected.push({
      program: JUPITER.program,
      data: (deposit ? 'f223c68952e1f2b6' : 'b80c569546c461e1') + u64(deposit ? amount : shares),
      keys: deposit
        ? [user, usdc, receipt, SOL_USDC, admin, target, JUPITER.receipt, ...tail]
        : [user, receipt, usdc, admin, target, SOL_USDC, JUPITER.receipt, ...tail],
    });
  } else fail();
  const fee = BigInt(step.evidence.platformFee ?? '0');
  if (fee > 0n) {
    if (!deposit) fail();
    const treasury = new PublicKey(step.evidence.feeTreasury!),
      destination = getAssociatedTokenAddressSync(
        new PublicKey(SOL_USDC),
        treasury,
        true,
      ).toBase58();
    expected.push({
      program: ASSOCIATED,
      data: '01',
      keys: [user, destination, treasury.toBase58(), SOL_USDC, SYSTEM, TOKEN],
    });
    expected.push({
      program: TOKEN,
      data: '0c' + u64(fee) + '06',
      keys: [usdc, SOL_USDC, destination, user],
    });
  }
  const keys = tx.message.staticAccountKeys.map((key) => key.toBase58());
  const actual = tx.message.compiledInstructions.map((ix) => ({
    program: keys[ix.programIdIndex],
    data: hex(ix.data),
    keys: Array.from(ix.accountKeyIndexes, (i) => keys[i]),
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail();
}
