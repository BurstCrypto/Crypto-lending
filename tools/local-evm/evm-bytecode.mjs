function byte(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) {
    throw new TypeError('Invalid EVM byte');
  }
  return value;
}

function selector(value) {
  if (!/^0x[0-9a-f]{8}$/u.test(value)) throw new TypeError('Invalid ABI selector');
  return [...Buffer.from(value.slice(2), 'hex')];
}

function address(value) {
  if (!/^0x[0-9a-f]{40}$/u.test(value)) throw new TypeError('Invalid EVM address');
  return [...Buffer.from(value.slice(2), 'hex')];
}

export const LOCAL_EVM_MUTATION_CONTROLLER = '0x000000000000000000000000000000000000c0de';

/**
 * Builds a deliberately tiny mock ERC-20 surface. It implements
 * `balanceOf(address)`, `decimals()`, and a sender-gated
 * `setBalance(address,uint256)`. The synthetic controller has no key and is
 * unlocked only inside the fresh, owned Hardhat child. Mutations can therefore
 * be real mined local transactions without signed or public-chain activity.
 */
export function buildMockStablecoinRuntimeBytecode() {
  const bytes = [];
  const labels = new Map();
  const fixups = [];
  const emit = (...values) => bytes.push(...values.map(byte));
  const mark = (name) => {
    labels.set(name, bytes.length);
    emit(0x5b); // JUMPDEST
  };
  const pushLabel = (name) => {
    emit(0x60, 0x00); // PUSH1 <label>
    fixups.push({ offset: bytes.length - 1, name });
  };

  emit(0x60, 0x00, 0x35); // PUSH1 0; CALLDATALOAD
  emit(0x60, 0xe0, 0x1c); // PUSH1 224; SHR
  emit(0x80, 0x63, ...selector('0x70a08231'), 0x14); // DUP1; balanceOf; EQ
  pushLabel('balanceOf');
  emit(0x57); // JUMPI
  emit(0x80, 0x63, ...selector('0x313ce567'), 0x14); // DUP1; decimals; EQ
  pushLabel('decimals');
  emit(0x57); // JUMPI
  emit(0x63, ...selector('0xe30443bc'), 0x14); // setBalance; EQ
  pushLabel('setBalance');
  emit(0x57); // JUMPI
  emit(0x60, 0x00, 0x60, 0x00, 0xfd); // REVERT(0, 0)

  mark('balanceOf');
  emit(0x60, 0x04, 0x35); // CALLDATALOAD(4)
  emit(0x60, 0x00, 0x52); // MSTORE(0, address)
  emit(0x60, 0x00, 0x60, 0x20, 0x52); // MSTORE(32, mapping slot 0)
  emit(0x60, 0x40, 0x60, 0x00, 0x20); // KECCAK256(0, 64)
  emit(0x54, 0x60, 0x00, 0x52); // SLOAD; MSTORE(0, value)
  emit(0x60, 0x20, 0x60, 0x00, 0xf3); // RETURN(0, 32)

  mark('setBalance');
  emit(0x33, 0x73, ...address(LOCAL_EVM_MUTATION_CONTROLLER), 0x14); // CALLER; controller; EQ
  pushLabel('authorizedSetBalance');
  emit(0x57); // JUMPI
  emit(0x60, 0x00, 0x60, 0x00, 0xfd); // REVERT(0, 0)

  mark('authorizedSetBalance');
  emit(0x60, 0x24, 0x35); // CALLDATALOAD(36): value remains below the slot
  emit(0x60, 0x04, 0x35); // CALLDATALOAD(4): wallet
  emit(0x60, 0x00, 0x52); // MSTORE(0, wallet)
  emit(0x60, 0x00, 0x60, 0x20, 0x52); // MSTORE(32, mapping slot 0)
  emit(0x60, 0x40, 0x60, 0x00, 0x20); // KECCAK256(0, 64)
  emit(0x55); // SSTORE(slot, value)
  emit(0x60, 0x00, 0x60, 0x00, 0xf3); // RETURN(0, 0)

  mark('decimals');
  emit(0x60, 0x06, 0x60, 0x00, 0x52); // MSTORE(0, 6)
  emit(0x60, 0x20, 0x60, 0x00, 0xf3); // RETURN(0, 32)

  for (const fixup of fixups) {
    const target = labels.get(fixup.name);
    if (target === undefined || target > 0xff) throw new TypeError('Invalid EVM label');
    bytes[fixup.offset] = target;
  }
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

export const MOCK_STABLECOIN_RUNTIME_BYTECODE = buildMockStablecoinRuntimeBytecode();
