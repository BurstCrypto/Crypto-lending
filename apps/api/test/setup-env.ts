// These syntactically valid endpoints let Nest construct lazy infrastructure
// clients in isolated tests. Tests that exercise a dependency provide their own
// reachable service configuration.
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/crypto_lending_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.REDIS_KEY_PREFIX ??= 'crypto-lending:test:v1:';
process.env.SQS_QUEUE_URL ??= 'http://127.0.0.1:4566/000000000000/crypto-lending-test-jobs';
process.env.SQS_DEAD_LETTER_QUEUE_URL ??=
  'http://127.0.0.1:4566/000000000000/crypto-lending-test-jobs-dlq';
