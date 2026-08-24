export const LOGGING_SECRET_CANARIES = Object.freeze({
  privateKey: ['-----BEGIN PRIVATE', ' KEY-----', 'KAN245-api-private-key-canary'].join(''),
  bearerToken: ['Bearer', ' KAN245-api-bearer-token-canary'].join(''),
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
  rawSignature: `0x${'cd'.repeat(65)}`,
  providerPayload: 'KAN245-raw-provider-error-payload-canary',
});

export const LOGGING_PROHIBITED_VALUES = Object.freeze(Object.values(LOGGING_SECRET_CANARIES));

export function adversarialProviderError(): Error {
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
      response: {
        body: LOGGING_SECRET_CANARIES.providerPayload,
        authorization: LOGGING_SECRET_CANARIES.bearerToken,
      },
    },
  );
  error.cause = {
    privateKey: LOGGING_SECRET_CANARIES.privateKey,
    signature: LOGGING_SECRET_CANARIES.rawSignature,
  };
  return error;
}
