import { LocalAaveReader, LocalAaveReadError } from './reader';
import { createLocalAaveServer, LOCAL_PORT, LOCAL_URL } from './server';
import { LocalSolanaReader, LocalSolanaReadError } from './solana-reader';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (
    process.env.NODE_ENV === 'production' ||
    args.length > 1 ||
    (args[0] !== undefined && !['--check', '--check-solana', '--check-both'].includes(args[0]))
  ) {
    throw new Error('Use npm run dev:chains:local, or npm run chains:local:check, in development.');
  }
  if (args[0] === '--check') {
    console.log(
      JSON.stringify(await new LocalAaveReader().read(null, new AbortController().signal), null, 2),
    );
    return;
  }
  if (args[0] === '--check-solana' || args[0] === '--check-both') {
    const solana = await new LocalSolanaReader().read(null, new AbortController().signal);
    const ethereum =
      args[0] === '--check-both'
        ? await new LocalAaveReader().read(null, new AbortController().signal)
        : undefined;
    console.log(JSON.stringify(ethereum ? { ethereum, solana } : solana, null, 2));
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
      `Local Ethereum + Solana: ${LOCAL_URL}\nReal mainnet reads. No AWS, API key or wallet signature required. Ctrl+C to stop.`,
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
    error instanceof LocalAaveReadError || error instanceof LocalSolanaReadError
      ? error.message
      : 'Local chains could not start. Run npm run dev:chains:local in development.',
  );
  process.exitCode = 1;
});
