import { LocalAaveReader, LocalAaveReadError } from './reader';
import { createLocalAaveServer, LOCAL_PORT, LOCAL_URL } from './server';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (
    process.env.NODE_ENV === 'production' ||
    args.length > 1 ||
    (args[0] !== undefined && args[0] !== '--check')
  ) {
    throw new Error('Use npm run dev:aave:local, or npm run aave:local:check, in development.');
  }
  if (args[0] === '--check') {
    console.log(
      JSON.stringify(await new LocalAaveReader().read(null, new AbortController().signal), null, 2),
    );
    return;
  }
  const server = createLocalAaveServer();
  server.once('error', () => {
    console.error(
      `Could not start ${LOCAL_URL}. Check whether port ${LOCAL_PORT} is already in use.`,
    );
    process.exitCode = 1;
  });
  server.listen(LOCAL_PORT, '127.0.0.1', () =>
    console.log(
      `Local Aave: ${LOCAL_URL}\nReal Ethereum reads. No AWS, API key or wallet signature required. Ctrl+C to stop.`,
    ),
  );
  const stop = (): void => {
    server.close();
    server.closeAllConnections();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof LocalAaveReadError
      ? error.message
      : 'Local Aave could not start. Run npm run dev:aave:local in development.',
  );
  process.exitCode = 1;
});
