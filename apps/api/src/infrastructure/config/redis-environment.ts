export function configuredRedisEnvironmentVariableNames(env: NodeJS.ProcessEnv): readonly string[] {
  return Object.keys(env).filter(
    (variableName) => variableName.startsWith('REDIS_') && env[variableName] !== undefined,
  );
}

export function hasRedisEnvironmentVariables(env: NodeJS.ProcessEnv): boolean {
  return configuredRedisEnvironmentVariableNames(env).length > 0;
}
