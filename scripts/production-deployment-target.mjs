import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
const TARGET_KEYS = Object.freeze([
  'targetId',
  'environment',
  'awsAccountId',
  'awsRegion',
  'publicOrigin',
  'cognito',
  'rds',
  'deployedComponents',
]);
const COGNITO_KEYS = Object.freeze(['userPoolId', 'appClientId', 'loginHost', 'issuer']);
const RDS_KEYS = Object.freeze([
  'cloudFormationStackId',
  'databaseInstanceArn',
  'databaseResourceId',
  'databaseManagedSecretArn',
  'applicationDataKeyArn',
]);
const COMPONENT_SET_KEYS = Object.freeze(['api', 'web', 'outboxWorker', 'migration']);
const COMPONENT_KEYS = Object.freeze(['imageUri', 'taskDefinitionArn']);
const REGISTRY_KEYS = Object.freeze(['schemaVersion', 'artifactType', 'targets']);
const DESTINATION_KEYS = Object.freeze([
  'destinationId',
  'epochId',
  'environment',
  'awsAccountId',
  'awsRegion',
  'stackName',
  'publicOrigin',
]);
const DESTINATION_REGISTRY_KEYS = Object.freeze(['schemaVersion', 'artifactType', 'destinations']);
const TARGET_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/u;
const REGION_PATTERN = /^[a-z]{2}-[a-z]+-[1-9][0-9]?$/u;
const STACK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,127}$/u;
const CLIENT_ID_PATTERN = /^[a-z0-9]{26}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CLOUDFORMATION_STACK_RESOURCE_PATTERN =
  /^stack\/[A-Za-z][A-Za-z0-9-]{0,127}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const RDS_DATABASE_RESOURCE_PATTERN = /^db:[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const RDS_MANAGED_SECRET_RESOURCE_PATTERN = /^secret:rds!db-[A-Za-z0-9/_+=.@-]{1,512}$/u;
const KMS_KEY_RESOURCE_PATTERN =
  /^key\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const MAX_DATABASE_RESOURCE_ID_LENGTH = 256;
const TARGET_HASH_DOMAIN = 'crypto-lending:production-deployment-target:v2';
const DESTINATION_HASH_DOMAIN = 'crypto-lending:production-deployment-destination:v1';
const DESTINATION_REGISTRY_HASH_DOMAIN =
  'crypto-lending:production-deployment-destination-registry:v1';
const VERIFIED_TARGETS = new WeakSet();
const VERIFIED_DESTINATIONS = new WeakSet();
/**
 * This empty deployed-target registry is retained as a fail-closed legacy
 * evidence boundary. Generated resource and image identities make source
 * enrollment circular with the release digest, so this module authorizes no
 * enrollment path. A future independently signed post-deploy enrollment
 * protocol must replace or extend this boundary; evidence cannot add a target.
 */
export const PRODUCTION_DEPLOYMENT_TARGET_REGISTRY = Object.freeze({
  schemaVersion: 2,
  artifactType: 'PRODUCTION_DEPLOYMENT_TARGET_REGISTRY',
  targets: Object.freeze([]),
});
/**
 * Prospective production trust is intentionally empty. Unlike a deployed
 * target, a destination contains only identities knowable before resources
 * exist. Enrollment still requires an independently reviewed source change.
 */
export const PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY = Object.freeze({
  schemaVersion: 1,
  artifactType: 'PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY',
  destinations: Object.freeze([]),
});
export class ProductionDeploymentTargetInvalidError extends Error {
  constructor() {
    super('Production deployment target is invalid');
    this.name = 'ProductionDeploymentTargetInvalidError';
  }
}
export class ProductionDeploymentDestinationInvalidError extends Error {
  constructor() {
    super('Production deployment destination is invalid');
    this.name = 'ProductionDeploymentDestinationInvalidError';
  }
}
function invalid() {
  throw new ProductionDeploymentTargetInvalidError();
}
function destinationInvalid() {
  throw new ProductionDeploymentDestinationInvalidError();
}
function record(value, expectedKeys, reject = invalid) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return reject();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return reject();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return reject();
  }
  const result = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) return reject();
    result[key] = descriptor.value;
  }
  return result;
}
function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return invalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value !== 'object') return invalid();
  const object = value;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}
function dnsHost(value) {
  if (value.length === 0 || value.length > 253 || isIP(value) !== 0) return false;
  const labels = value.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  );
}
function httpsOrigin(value, reject = invalid) {
  if (typeof value !== 'string' || value.length > 255) return reject();
  let url;
  try {
    url = new URL(value);
  } catch {
    return reject();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.hostname !== url.hostname.toLowerCase() ||
    !dnsHost(url.hostname) ||
    value !== url.origin
  ) {
    return reject();
  }
  return Object.freeze({ origin: value, hostname: url.hostname });
}
function deploymentDestination(value) {
  const parsed = record(value, DESTINATION_KEYS, destinationInvalid);
  if (
    typeof parsed.destinationId !== 'string' ||
    parsed.destinationId.length > 96 ||
    !TARGET_ID_PATTERN.test(parsed.destinationId) ||
    typeof parsed.epochId !== 'string' ||
    !SHA256_PATTERN.test(parsed.epochId) ||
    /^0{64}$/u.test(parsed.epochId) ||
    parsed.environment !== 'production' ||
    typeof parsed.awsAccountId !== 'string' ||
    !ACCOUNT_ID_PATTERN.test(parsed.awsAccountId) ||
    /^0{12}$/u.test(parsed.awsAccountId) ||
    typeof parsed.awsRegion !== 'string' ||
    !REGION_PATTERN.test(parsed.awsRegion) ||
    typeof parsed.stackName !== 'string' ||
    !STACK_NAME_PATTERN.test(parsed.stackName)
  ) {
    return destinationInvalid();
  }
  const origin = httpsOrigin(parsed.publicOrigin, destinationInvalid);
  return Object.freeze({
    destinationId: parsed.destinationId,
    epochId: parsed.epochId,
    environment: 'production',
    awsAccountId: parsed.awsAccountId,
    awsRegion: parsed.awsRegion,
    stackName: parsed.stackName,
    publicOrigin: origin.origin,
  });
}
export function productionDeploymentDestinationSha256(value) {
  try {
    const destination = deploymentDestination(value);
    return createHash('sha256')
      .update(`${DESTINATION_HASH_DOMAIN}\n`, 'utf8')
      .update(canonicalJson(destination), 'utf8')
      .digest('hex');
  } catch {
    return destinationInvalid();
  }
}
function validatedDestinationRegistry(value) {
  const parsed = record(value, DESTINATION_REGISTRY_KEYS, destinationInvalid);
  if (
    parsed.schemaVersion !== 1 ||
    parsed.artifactType !== 'PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY' ||
    !Array.isArray(parsed.destinations) ||
    parsed.destinations.length > 16
  ) {
    return destinationInvalid();
  }
  const ids = new Set();
  const epochs = new Set();
  const physicalDestinations = new Set();
  const destinations = parsed.destinations.map((candidate) => {
    const destination = deploymentDestination(candidate);
    const physicalDestination = [
      destination.awsAccountId,
      destination.awsRegion,
      destination.stackName,
    ].join('\0');
    if (
      ids.has(destination.destinationId) ||
      epochs.has(destination.epochId) ||
      physicalDestinations.has(physicalDestination)
    ) {
      return destinationInvalid();
    }
    ids.add(destination.destinationId);
    epochs.add(destination.epochId);
    physicalDestinations.add(physicalDestination);
    return destination;
  });
  const normalizedRegistry = {
    schemaVersion: 1,
    artifactType: 'PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY',
    destinations,
  };
  return Object.freeze({
    registrySha256: createHash('sha256')
      .update(`${DESTINATION_REGISTRY_HASH_DOMAIN}\n`, 'utf8')
      .update(canonicalJson(normalizedRegistry), 'utf8')
      .digest('hex'),
    destinations: Object.freeze(destinations),
  });
}
function resolveDestinationAgainstRegistry(destinationId, destinationSha256, registry) {
  try {
    if (
      typeof destinationId !== 'string' ||
      !TARGET_ID_PATTERN.test(destinationId) ||
      typeof destinationSha256 !== 'string' ||
      !SHA256_PATTERN.test(destinationSha256)
    ) {
      return destinationInvalid();
    }
    const validated = validatedDestinationRegistry(registry);
    const destination = validated.destinations.find(
      (candidate) => candidate.destinationId === destinationId,
    );
    if (
      destination === undefined ||
      productionDeploymentDestinationSha256(destination) !== destinationSha256
    ) {
      return destinationInvalid();
    }
    return Object.freeze({
      ...destination,
      destinationSha256,
      registrySha256: validated.registrySha256,
    });
  } catch {
    return destinationInvalid();
  }
}
export function resolveProductionDeploymentDestination(destinationId, destinationSha256) {
  const destination = resolveDestinationAgainstRegistry(
    destinationId,
    destinationSha256,
    PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY,
  );
  VERIFIED_DESTINATIONS.add(destination);
  return destination;
}
/** Test seam; the returned destination deliberately lacks the production brand. */
export function resolveProductionDeploymentDestinationWithTestRegistry(
  destinationId,
  destinationSha256,
  registry,
) {
  return resolveDestinationAgainstRegistry(destinationId, destinationSha256, registry);
}
export function isVerifiedProductionDeploymentDestination(value) {
  return typeof value === 'object' && value !== null && VERIFIED_DESTINATIONS.has(value);
}
function componentIdentity(value, accountId, region, expectedRepository) {
  const parsed = record(value, COMPONENT_KEYS);
  if (typeof parsed.imageUri !== 'string' || typeof parsed.taskDefinitionArn !== 'string') {
    return invalid();
  }
  const imagePrefix = `${accountId}.dkr.ecr.${region}.amazonaws.com/`;
  if (!parsed.imageUri.startsWith(imagePrefix)) return invalid();
  const imagePath = parsed.imageUri.slice(imagePrefix.length);
  const imageMatch = imagePath.match(
    /^([a-z0-9](?:[a-z0-9._/-]{0,253}[a-z0-9])?)@sha256:([a-f0-9]{64})$/u,
  );
  if (
    imageMatch === null ||
    imageMatch[1] !== expectedRepository ||
    imageMatch[1]?.includes('//') === true ||
    imageMatch[1]
      ?.split('/')
      .some((segment) => segment === '.' || segment === '..' || segment.length === 0) === true
  ) {
    return invalid();
  }
  const taskPrefix = `arn:aws:ecs:${region}:${accountId}:task-definition/`;
  if (!parsed.taskDefinitionArn.startsWith(taskPrefix)) return invalid();
  const taskIdentity = parsed.taskDefinitionArn.slice(taskPrefix.length);
  if (!/^[A-Za-z0-9_-]{1,255}:[1-9][0-9]*$/u.test(taskIdentity)) return invalid();
  return Object.freeze({
    imageUri: parsed.imageUri,
    taskDefinitionArn: parsed.taskDefinitionArn,
  });
}
function regionalArn(value, service, accountId, region, resourcePattern) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_024) return invalid();
  const prefix = `arn:aws:${service}:${region}:${accountId}:`;
  if (!value.startsWith(prefix) || !resourcePattern.test(value.slice(prefix.length))) {
    return invalid();
  }
  return value;
}
function opaqueDatabaseResourceId(value) {
  const containsAsciiControl =
    typeof value === 'string' &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    });
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_DATABASE_RESOURCE_ID_LENGTH ||
    value.trim() !== value ||
    containsAsciiControl
  ) {
    return invalid();
  }
  return value;
}
function rdsIdentity(value, accountId, region) {
  const parsed = record(value, RDS_KEYS);
  const databaseInstanceArn = regionalArn(
    parsed.databaseInstanceArn,
    'rds',
    accountId,
    region,
    RDS_DATABASE_RESOURCE_PATTERN,
  );
  if (databaseInstanceArn.slice(databaseInstanceArn.lastIndexOf(':db:') + 4).includes('--')) {
    return invalid();
  }
  return Object.freeze({
    cloudFormationStackId: regionalArn(
      parsed.cloudFormationStackId,
      'cloudformation',
      accountId,
      region,
      CLOUDFORMATION_STACK_RESOURCE_PATTERN,
    ),
    databaseInstanceArn,
    databaseResourceId: opaqueDatabaseResourceId(parsed.databaseResourceId),
    databaseManagedSecretArn: regionalArn(
      parsed.databaseManagedSecretArn,
      'secretsmanager',
      accountId,
      region,
      RDS_MANAGED_SECRET_RESOURCE_PATTERN,
    ),
    applicationDataKeyArn: regionalArn(
      parsed.applicationDataKeyArn,
      'kms',
      accountId,
      region,
      KMS_KEY_RESOURCE_PATTERN,
    ),
  });
}
function deploymentTarget(value) {
  const parsed = record(value, TARGET_KEYS);
  if (
    typeof parsed.targetId !== 'string' ||
    parsed.targetId.length > 96 ||
    !TARGET_ID_PATTERN.test(parsed.targetId) ||
    parsed.environment !== 'production' ||
    typeof parsed.awsAccountId !== 'string' ||
    !ACCOUNT_ID_PATTERN.test(parsed.awsAccountId) ||
    /^0{12}$/u.test(parsed.awsAccountId) ||
    typeof parsed.awsRegion !== 'string' ||
    !REGION_PATTERN.test(parsed.awsRegion)
  ) {
    return invalid();
  }
  httpsOrigin(parsed.publicOrigin);
  const cognito = record(parsed.cognito, COGNITO_KEYS);
  if (
    typeof cognito.userPoolId !== 'string' ||
    !new RegExp(`^${parsed.awsRegion}_[A-Za-z0-9]{1,64}$`, 'u').test(cognito.userPoolId) ||
    typeof cognito.appClientId !== 'string' ||
    !CLIENT_ID_PATTERN.test(cognito.appClientId) ||
    typeof cognito.loginHost !== 'string' ||
    cognito.loginHost !== cognito.loginHost.toLowerCase() ||
    !dnsHost(cognito.loginHost)
  ) {
    return invalid();
  }
  const loginSuffix = `.auth.${parsed.awsRegion}.amazoncognito.com`;
  const loginPrefix = cognito.loginHost.slice(0, -loginSuffix.length);
  if (
    !cognito.loginHost.endsWith(loginSuffix) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(loginPrefix) ||
    cognito.issuer !== `https://cognito-idp.${parsed.awsRegion}.amazonaws.com/${cognito.userPoolId}`
  ) {
    return invalid();
  }
  const components = record(parsed.deployedComponents, COMPONENT_SET_KEYS);
  const rds = rdsIdentity(parsed.rds, parsed.awsAccountId, parsed.awsRegion);
  const api = componentIdentity(
    components.api,
    parsed.awsAccountId,
    parsed.awsRegion,
    'crypto-lending-api',
  );
  const web = componentIdentity(
    components.web,
    parsed.awsAccountId,
    parsed.awsRegion,
    'crypto-lending-web',
  );
  const outboxWorker = componentIdentity(
    components.outboxWorker,
    parsed.awsAccountId,
    parsed.awsRegion,
    'crypto-lending-api',
  );
  const migration = componentIdentity(
    components.migration,
    parsed.awsAccountId,
    parsed.awsRegion,
    'crypto-lending-api',
  );
  const taskDefinitions = new Set([
    api.taskDefinitionArn,
    web.taskDefinitionArn,
    outboxWorker.taskDefinitionArn,
    migration.taskDefinitionArn,
  ]);
  if (
    taskDefinitions.size !== COMPONENT_SET_KEYS.length ||
    outboxWorker.imageUri !== api.imageUri ||
    migration.imageUri !== api.imageUri
  ) {
    return invalid();
  }
  return Object.freeze({
    targetId: parsed.targetId,
    environment: 'production',
    awsAccountId: parsed.awsAccountId,
    awsRegion: parsed.awsRegion,
    publicOrigin: parsed.publicOrigin,
    cognito: Object.freeze({
      userPoolId: cognito.userPoolId,
      appClientId: cognito.appClientId,
      loginHost: cognito.loginHost,
      issuer: cognito.issuer,
    }),
    rds,
    deployedComponents: Object.freeze({ api, web, outboxWorker, migration }),
  });
}
export function productionDeploymentTargetSha256(value) {
  try {
    const target = deploymentTarget(value);
    return createHash('sha256')
      .update(`${TARGET_HASH_DOMAIN}\n`, 'utf8')
      .update(canonicalJson(target), 'utf8')
      .digest('hex');
  } catch {
    return invalid();
  }
}
function validatedRegistry(value) {
  const parsed = record(value, REGISTRY_KEYS);
  if (
    parsed.schemaVersion !== 2 ||
    parsed.artifactType !== 'PRODUCTION_DEPLOYMENT_TARGET_REGISTRY' ||
    !Array.isArray(parsed.targets) ||
    parsed.targets.length > 16
  ) {
    return invalid();
  }
  const ids = new Set();
  const targets = parsed.targets.map((candidate) => {
    const target = deploymentTarget(candidate);
    if (ids.has(target.targetId)) return invalid();
    ids.add(target.targetId);
    return target;
  });
  const normalizedRegistry = {
    schemaVersion: 2,
    artifactType: 'PRODUCTION_DEPLOYMENT_TARGET_REGISTRY',
    targets,
  };
  return Object.freeze({
    registrySha256: createHash('sha256')
      .update(canonicalJson(normalizedRegistry), 'utf8')
      .digest('hex'),
    targets: Object.freeze(targets),
  });
}
function resolveAgainstRegistry(targetId, targetSha256, registry) {
  try {
    if (
      typeof targetId !== 'string' ||
      !TARGET_ID_PATTERN.test(targetId) ||
      typeof targetSha256 !== 'string' ||
      !SHA256_PATTERN.test(targetSha256)
    ) {
      return invalid();
    }
    const validated = validatedRegistry(registry);
    const target = validated.targets.find((candidate) => candidate.targetId === targetId);
    if (target === undefined || productionDeploymentTargetSha256(target) !== targetSha256) {
      return invalid();
    }
    return Object.freeze({
      ...target,
      targetSha256,
      registrySha256: validated.registrySha256,
    });
  } catch {
    return invalid();
  }
}
export function resolveProductionDeploymentTarget(targetId, targetSha256) {
  const target = resolveAgainstRegistry(
    targetId,
    targetSha256,
    PRODUCTION_DEPLOYMENT_TARGET_REGISTRY,
  );
  VERIFIED_TARGETS.add(target);
  return target;
}
/** Test seam; the returned target deliberately lacks the production brand. */
export function resolveProductionDeploymentTargetWithTestRegistry(
  targetId,
  targetSha256,
  registry,
) {
  return resolveAgainstRegistry(targetId, targetSha256, registry);
}
export function isVerifiedProductionDeploymentTarget(value) {
  return typeof value === 'object' && value !== null && VERIFIED_TARGETS.has(value);
}
