export function enforceMigrationCliMode(
  arguments_: readonly string[],
  env: NodeJS.ProcessEnv,
): string[] {
  const cliArguments = [...arguments_];
  if (cliArguments[0] !== '--production') {
    return cliArguments;
  }

  const configuredEnvironment = env.NODE_ENV?.trim().toLowerCase();
  if (configuredEnvironment && configuredEnvironment !== 'production') {
    throw new Error(`The production migration entrypoint cannot run with NODE_ENV=${env.NODE_ENV}`);
  }

  env.NODE_ENV = 'production';
  cliArguments.shift();
  return cliArguments;
}
