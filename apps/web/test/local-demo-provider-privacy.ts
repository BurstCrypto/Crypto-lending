import { expect } from 'vitest';

const PROVIDER_VENDOR_OR_PROTOCOL =
  /\b(?:morpho(?:[\s._/-]*blue)?|kamino(?:[\s._/-]*lend)?|aave(?:[\s._/-]*v[23])?|save|solend|compound[\s._/-]*(?:iii|v3)|moonwell(?:[\s._/-]*v2)?|spark[\s._/-]*lend|venus|euler[\s._/-]*v2|p0|project[\s._/-]*0|marginfi(?:[\s._/-]*v2)?)(?:[\s._/-]*(?:finance|protocol))?\b/iu;
const PRODUCTION_NETWORK_OR_ASSET =
  /\b(?:ethereum|base|bnb(?:[\s._/-]*(?:chain|smart[\s._/-]*chain))?)\b|eip155:(?:1|56|8453)|0x[0-9a-f]{40,64}/iu;
const PROVIDER_PRIVATE_JSON_FIELD =
  /"(?:provider|protocol|market|reserve|opportunit|provenance|source(?:Id|Reference|ObservedAt)|retrievedAt|payloadSha256|normalizer|attributes|endpoint|url|uri)[A-Za-z0-9_]*"\s*:/iu;
const PROVIDER_PRIVATE_HTML_ATTRIBUTE =
  /\b(?:data-|aria-)?(?:provider|protocol|market|reserve|opportunit|provenance|source-reference|normalizer)(?:-[a-z0-9]+)*\s*=/iu;
const PROVIDER_PRIVATE_FIELD_NAME =
  /\b(?:provider(?:Id|Ids|Name)|protocol(?:Id|Ids|Name)|market(?:Id|Ids)|reserve(?:Id|Ids)|opportunity(?:Id|Ids)|provenance|sourceReference|sourceObservedAt|payloadSha256|normalizer(?:Id|Version))\b/iu;
const EXTERNAL_URL = /https?(?::\/\/|%3a%2f%2f)/iu;

export const LOCAL_DEMO_PROVIDER_PRIVACY_CANARY = new RegExp(
  [
    PROVIDER_VENDOR_OR_PROTOCOL.source,
    PRODUCTION_NETWORK_OR_ASSET.source,
    PROVIDER_PRIVATE_JSON_FIELD.source,
    PROVIDER_PRIVATE_HTML_ATTRIBUTE.source,
    PROVIDER_PRIVATE_FIELD_NAME.source,
    EXTERNAL_URL.source,
  ].join('|'),
  'iu',
);

export const LOCAL_DEMO_PROVIDER_PRIVACY_TEST_CANARIES = Object.freeze([
  'Morpho Blue',
  'https://api.morpho.org/graphql',
  'Kamino Lend',
  'https://api.kamino.finance/markets',
  'Aave V3',
  'https://aave.com/markets',
  'Save (Solend)',
  'https://save.finance/reserves',
  'Compound III',
  'Moonwell V2',
  'SparkLend',
  'Venus',
  'Euler V2',
  'P0',
  'Project 0',
  'marginfi v2',
  'BNB',
  'eip155:56',
  '{"providerIds":["SOURCE_A"]}',
  '{"protocolId":"LENDING_V1"}',
  '{"marketId":"opaque-market"}',
  '{"reserveId":"opaque-reserve"}',
  '{"opportunityId":"opaque-opportunity"}',
  '{"provenance":{"sourceReference":"opaque-source"}}',
  '{"sourceObservedAt":"2026-08-27T00:00:00.000Z"}',
  '{"payloadSha256":"opaque-digest"}',
  '{"normalizerVersion":"1.0.0"}',
  '<span data-provider-id="opaque-source">Managed</span>',
  '<span>marketId</span>',
] as const);

export const LOCAL_DEMO_PROVIDER_PRIVACY_SAFE_COPY_TEST_CANARIES = Object.freeze([
  'Yield compounds over the selected horizon.',
  'Spark a refreshed allocation preview.',
  'Project the estimated annual yield after fees.',
  'The Euler formula is not provider metadata.',
  'The moon is well above the horizon.',
] as const);

export function expectProviderPrivateValue(value: unknown): void {
  const serialized = JSON.stringify(value) ?? '';
  const errorDetails = value instanceof Error ? `${value.name}: ${value.message}` : '';
  expect(`${errorDetails}\n${serialized}`).not.toMatch(LOCAL_DEMO_PROVIDER_PRIVACY_CANARY);
}

export function expectProviderPrivateDom(container: HTMLElement): void {
  expect(container.outerHTML).not.toMatch(LOCAL_DEMO_PROVIDER_PRIVACY_CANARY);
}
