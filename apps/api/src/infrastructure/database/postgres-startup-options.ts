const POSTGRES_ROLE_IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;

/** Builds fixed wire-protocol startup settings; callers must separately allowlist the role. */
export function postgresStartupOptions(role: string): string {
  if (!POSTGRES_ROLE_IDENTIFIER.test(role)) {
    throw new Error('PostgreSQL startup role must be a lowercase identifier');
  }
  // pg_catalog remains implicitly first; public is the reviewed application
  // schema and pg_temp is explicit last. Database TEMP and schema CREATE are
  // denied to runtime logins/capability roles.
  return `-c role=${role} -c search_path=public,pg_temp`;
}
