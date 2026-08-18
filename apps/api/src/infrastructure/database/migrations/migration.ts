export interface DatabaseMigration {
  /** Immutable, sortable identifier. Never edit an applied migration. */
  id: string;
  description: string;
  upSql: string;
  downSql: string;
}
