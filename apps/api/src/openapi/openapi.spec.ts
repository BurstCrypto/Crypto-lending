import { shouldExposeOpenApi } from './openapi';

describe('OpenAPI exposure policy', () => {
  it('keeps documentation available outside production by default', () => {
    expect(shouldExposeOpenApi({ NODE_ENV: 'development' })).toBe(true);
    expect(shouldExposeOpenApi({ NODE_ENV: 'test' })).toBe(true);
  });

  it('fails closed in production unless explicitly enabled', () => {
    expect(shouldExposeOpenApi({ NODE_ENV: 'production' })).toBe(false);
    expect(shouldExposeOpenApi({ NODE_ENV: ' Production ' })).toBe(false);
    expect(shouldExposeOpenApi({ NODE_ENV: 'production', API_DOCS_ENABLED: 'true' })).toBe(true);
    expect(shouldExposeOpenApi({ NODE_ENV: 'development', API_DOCS_ENABLED: 'false' })).toBe(false);
  });

  it('rejects ambiguous configuration', () => {
    expect(() => shouldExposeOpenApi({ API_DOCS_ENABLED: 'yes' })).toThrow(
      'API_DOCS_ENABLED must be either true or false',
    );
  });
});
