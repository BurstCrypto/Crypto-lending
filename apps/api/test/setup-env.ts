// These syntactically valid endpoints let Nest construct lazy infrastructure
// clients in isolated tests. Tests that exercise a dependency provide their own
// reachable service configuration.
if (
  !process.env.DATABASE_RUNTIME_URL &&
  !process.env.DATABASE_RUNTIME_HOST &&
  !process.env.DATABASE_URL &&
  !process.env.DATABASE_HOST
) {
  process.env.DATABASE_RUNTIME_URL = 'postgres://test:test@127.0.0.1:5432/crypto_lending_test';
  process.env.DATABASE_RUNTIME_SSL_MODE = 'disable';
}
if (
  !process.env.REDIS_URL &&
  !process.env.REDIS_HOST &&
  !process.env.REDIS_PORT &&
  !process.env.REDIS_USERNAME &&
  !process.env.REDIS_PASSWORD
) {
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = '6379';
  process.env.REDIS_TLS = 'false';
  process.env.REDIS_USERNAME = 'crypto_api_a';
  process.env.REDIS_PASSWORD = 'local-api-current';
}
process.env.SQS_QUEUE_URL ??= 'http://127.0.0.1:4566/000000000000/crypto-lending-test-jobs';
process.env.SQS_DEAD_LETTER_QUEUE_URL ??=
  'http://127.0.0.1:4566/000000000000/crypto-lending-test-jobs-dlq';
