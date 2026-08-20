export interface DatabaseMigration {
  /** Immutable, sortable identifier. Never edit an applied migration. */
  id: string;
  description: string;
  upSql: string | readonly string[];
  downSql: string | readonly string[];
  /** Returns exactly one row with a boolean `valid` column when applied. */
  verifySql?: string;
  /**
   * Defaults to true. False permits operations such as CREATE INDEX
   * CONCURRENTLY; every statement must then be safe to replay because the DDL
   * and schema-migration record cannot be committed atomically.
   */
  transactional?: boolean;
}
