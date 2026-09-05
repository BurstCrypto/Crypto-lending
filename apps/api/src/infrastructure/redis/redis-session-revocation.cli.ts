import { runRedisSessionRevocation } from './redis-session-revocation';

void runRedisSessionRevocation(process.argv.slice(2), process.env)
  .then((result) => {
    if (result.status === 'completed') {
      process.stdout.write(
        `${JSON.stringify({
          status: result.status,
          inactiveSlot: result.inactiveSlot,
          killedClientCount: result.killedClientCount,
        })}\n`,
      );
    } else {
      process.stderr.write(`${JSON.stringify({ status: result.status, code: result.code })}\n`);
    }
    process.exitCode = result.exitCode;
  })
  .catch(() => {
    process.stderr.write(`${JSON.stringify({ status: 'refused', code: 'OPERATION_FAILED' })}\n`);
    process.exitCode = 1;
  });
