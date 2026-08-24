export const LOGGING_SECRET_CANARIES = Object.freeze({
  privateKey: ['-----BEGIN PRIVATE', ' KEY-----', 'KAN245-private-key-canary'].join(''),
  bearerToken: ['Bearer', ' KAN245-bearer-token-canary'].join(''),
  capabilityToken: ['KAN245-ledger', '-capability-token-canary'].join(''),
  idempotencyToken: ['KAN245-idempotency', '-token-canary'].join(''),
  credentials: [
    'post',
    'gresql://',
    'kan245-user',
    ':KAN245-password',
    '@private.invalid/',
    'kan245?sslmode=require',
  ].join(''),
  rawSignature: `0x${'ab'.repeat(65)}KAN245-raw-signature-canary`,
  providerPayload: 'KAN245-raw-provider-error-payload-canary',
});

export const LOGGING_PROHIBITED_VALUES = Object.freeze(Object.values(LOGGING_SECRET_CANARIES));

export function adversarialLoggingError(): Error {
  const error = Object.assign(
    new Error(
      [
        LOGGING_SECRET_CANARIES.bearerToken,
        LOGGING_SECRET_CANARIES.privateKey,
        LOGGING_SECRET_CANARIES.rawSignature,
      ].join(' '),
    ),
    {
      code: LOGGING_SECRET_CANARIES.capabilityToken,
      credentials: LOGGING_SECRET_CANARIES.credentials,
      idempotencyKey: LOGGING_SECRET_CANARIES.idempotencyToken,
      providerResponse: {
        body: LOGGING_SECRET_CANARIES.providerPayload,
      },
    },
  );
  error.cause = {
    authorization: LOGGING_SECRET_CANARIES.bearerToken,
    signature: LOGGING_SECRET_CANARIES.rawSignature,
  };
  return error;
}
