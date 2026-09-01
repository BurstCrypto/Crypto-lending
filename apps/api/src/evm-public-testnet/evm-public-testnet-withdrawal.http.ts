import { getAddress, isAddress } from 'viem';

import { EVM_PUBLIC_TESTNET_CHAIN_ID } from './evm-public-testnet.constants';
import {
  EvmPublicTestnetBodyError,
  parseEvmPublicTestnetIntentId,
  parseEvmPublicTestnetSubmissionBody,
} from './evm-public-testnet.http';
import type {
  EvmPublicTestnetWithdrawalRequest,
  EvmPublicTestnetWithdrawalSubmissionRequest,
} from './evm-public-testnet-withdrawal.service';

function fail(): never {
  throw new EvmPublicTestnetBodyError();
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.keys(descriptors);
  if (
    names.length !== keys.length ||
    names.some((name) => !keys.includes(name)) ||
    keys.some((key) => descriptors[key] === undefined || !Object.hasOwn(descriptors[key]!, 'value'))
  ) {
    return fail();
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key]?.value]));
}

export function parseEvmPublicTestnetWithdrawalBody(
  value: unknown,
): EvmPublicTestnetWithdrawalRequest {
  const body = exactRecord(value, ['chainId', 'account']);
  if (
    body.chainId !== EVM_PUBLIC_TESTNET_CHAIN_ID ||
    typeof body.account !== 'string' ||
    !isAddress(body.account, { strict: true }) ||
    /^0x0{40}$/iu.test(body.account)
  ) {
    return fail();
  }
  return Object.freeze({
    chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
    account: getAddress(body.account),
  });
}

export function parseEvmPublicTestnetWithdrawalSubmissionBody(
  value: unknown,
): EvmPublicTestnetWithdrawalSubmissionRequest {
  return parseEvmPublicTestnetSubmissionBody(value);
}

export const parseEvmPublicTestnetWithdrawalIntentId = parseEvmPublicTestnetIntentId;
