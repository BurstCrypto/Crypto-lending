export interface ProductionDeployedComponentIdentity {
  readonly imageUri: string;
  readonly taskDefinitionArn: string;
}

export interface ProductionDeploymentTarget {
  readonly targetId: string;
  readonly environment: 'production';
  readonly awsAccountId: string;
  readonly awsRegion: string;
  readonly publicOrigin: string;
  readonly cognito: Readonly<{
    userPoolId: string;
    appClientId: string;
    loginHost: string;
    issuer: string;
  }>;
  readonly rds: Readonly<{
    cloudFormationStackId: string;
    databaseInstanceArn: string;
    databaseResourceId: string;
    databaseManagedSecretArn: string;
    applicationDataKeyArn: string;
  }>;
  readonly deployedComponents: Readonly<{
    api: ProductionDeployedComponentIdentity;
    web: ProductionDeployedComponentIdentity;
    outboxWorker: ProductionDeployedComponentIdentity;
    migration: ProductionDeployedComponentIdentity;
  }>;
}

export interface ProductionDeploymentTargetRegistry {
  readonly schemaVersion: 2;
  readonly artifactType: 'PRODUCTION_DEPLOYMENT_TARGET_REGISTRY';
  readonly targets: readonly ProductionDeploymentTarget[];
}

export interface ResolvedProductionDeploymentTarget extends ProductionDeploymentTarget {
  readonly targetSha256: string;
  readonly registrySha256: string;
}

declare const verifiedProductionDeploymentTargetBrand: unique symbol;

export interface VerifiedProductionDeploymentTarget extends ResolvedProductionDeploymentTarget {
  readonly [verifiedProductionDeploymentTargetBrand]: true;
}

export interface ProductionDeploymentDestination {
  readonly destinationId: string;
  readonly epochId: string;
  readonly environment: 'production';
  readonly awsAccountId: string;
  readonly awsRegion: string;
  readonly stackName: string;
  readonly publicOrigin: string;
}

export interface ProductionDeploymentDestinationRegistry {
  readonly schemaVersion: 1;
  readonly artifactType: 'PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY';
  readonly destinations: readonly ProductionDeploymentDestination[];
}

export interface ResolvedProductionDeploymentDestination extends ProductionDeploymentDestination {
  readonly destinationSha256: string;
  readonly registrySha256: string;
}

declare const verifiedProductionDeploymentDestinationBrand: unique symbol;

export interface VerifiedProductionDeploymentDestination extends ResolvedProductionDeploymentDestination {
  readonly [verifiedProductionDeploymentDestinationBrand]: true;
}

export const PRODUCTION_DEPLOYMENT_TARGET_REGISTRY: ProductionDeploymentTargetRegistry;
export const PRODUCTION_DEPLOYMENT_DESTINATION_REGISTRY: ProductionDeploymentDestinationRegistry;

export class ProductionDeploymentTargetInvalidError extends Error {
  constructor();
}

export class ProductionDeploymentDestinationInvalidError extends Error {
  constructor();
}

export function productionDeploymentTargetSha256(value: unknown): string;
export function resolveProductionDeploymentTarget(
  targetId: string,
  targetSha256: string,
): VerifiedProductionDeploymentTarget;
export function resolveProductionDeploymentTargetWithTestRegistry(
  targetId: string,
  targetSha256: string,
  registry: ProductionDeploymentTargetRegistry,
): ResolvedProductionDeploymentTarget;
export function isVerifiedProductionDeploymentTarget(
  value: unknown,
): value is VerifiedProductionDeploymentTarget;

export function productionDeploymentDestinationSha256(value: unknown): string;
export function resolveProductionDeploymentDestination(
  destinationId: string,
  destinationSha256: string,
): VerifiedProductionDeploymentDestination;
export function resolveProductionDeploymentDestinationWithTestRegistry(
  destinationId: string,
  destinationSha256: string,
  registry: ProductionDeploymentDestinationRegistry,
): ResolvedProductionDeploymentDestination;
export function isVerifiedProductionDeploymentDestination(
  value: unknown,
): value is VerifiedProductionDeploymentDestination;
