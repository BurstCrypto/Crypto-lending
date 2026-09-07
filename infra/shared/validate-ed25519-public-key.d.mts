export class Ed25519PublicKeyInvalidError extends Error {
  constructor();
}

/**
 * Validates a 32-byte canonical, nonidentity Ed25519 public point in the
 * prime-order subgroup. Returns true on success and throws
 * Ed25519PublicKeyInvalidError on every rejected input.
 */
export function validateEd25519PublicKeyBytes(value: unknown): true;

/** Returns false rather than throwing for every rejected input. */
export function isValidEd25519PublicKeyBytes(value: unknown): boolean;
