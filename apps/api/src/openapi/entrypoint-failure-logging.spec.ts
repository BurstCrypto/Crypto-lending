import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('CLI entrypoint failure logging', () => {
  it.each([
    ['migration', '../infrastructure/database/migration.cli.ts', 'migrationFailed'],
    ['OpenAPI', 'generate-openapi.ts', 'openApiFailed'],
  ])(
    'routes %s failures through the structured fatal logger without reading exception text',
    (_name, relativePath, eventName) => {
      const source = readFileSync(resolve(__dirname, relativePath), 'utf8');

      expect(source).toContain(
        `structuredLogger.emitFatal(LOG_EVENTS.${eventName}, error, { outcome: 'failure' })`,
      );
      expect(source).not.toMatch(/\berror\.(?:message|stack)\b/u);
      expect(source).not.toMatch(/\bString\(error\)/u);
      expect(source).not.toMatch(/\bconsole\.error\b/u);
      expect(source).not.toMatch(/process\.stderr\.write/u);
    },
  );

  it('loads local environment files silently in every executable', () => {
    const entrypoints = [
      '../main.ts',
      '../infrastructure/database/migration.cli.ts',
      '../infrastructure/outbox/outbox-worker.cli.ts',
      '../infrastructure/outbox/outbox-worker-health.cli.ts',
      'generate-openapi.ts',
    ];

    for (const relativePath of entrypoints) {
      const source = readFileSync(resolve(__dirname, relativePath), 'utf8');
      expect(source).toContain('config/load-dotenv');
      expect(source).not.toContain('dotenv/config');
    }

    const loader = readFileSync(
      resolve(__dirname, '../infrastructure/config/load-dotenv.ts'),
      'utf8',
    );
    expect(loader).toContain('config({ quiet: true })');
  });
});
