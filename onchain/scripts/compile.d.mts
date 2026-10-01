import type { Abi } from 'viem';
export interface CompiledContract {
  abi: Abi;
  evm: {
    bytecode: { object: string };
    deployedBytecode: {
      object: string;
      immutableReferences: Record<string, { start: number; length: number }[]>;
    };
  };
}
export function compileContracts(
  includeTests?: boolean,
): Record<string, Record<string, CompiledContract>>;
