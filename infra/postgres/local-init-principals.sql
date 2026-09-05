\set ON_ERROR_STOP on

-- Local Docker fixtures only. Production passwords are generated and injected
-- from separately scoped secrets; they are never embedded in this repository.
SET password_encryption = 'scram-sha-256';

-- Non-secret safety marker consumed by the destructive UUID-scoped integration
-- suite. A loopback hostname alone could be a tunnel to a managed database.
ALTER DATABASE crypto_lending
  SET crypto_lending.local_principal_fixture = 'crypto-lending-compose-principals-v2';

CREATE ROLE crypto_migration
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD 'local_migration_only';
CREATE ROLE crypto_api_login_a
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD 'local_api_database_a';
CREATE ROLE crypto_worker_login_a
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD 'local_worker_database_a';
-- The dormant balance consumer has no local credential. Its LOGIN exists only
-- so the source-only bootstrap boundary can bind the exact rotation identity;
-- it cannot authenticate until a separately authorized credential is set.
CREATE ROLE crypto_balance_consumer_login_a
  LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD NULL;

-- Runtime identities must not inherit PostgreSQL's default ability to connect
-- to the maintenance database.
REVOKE ALL PRIVILEGES ON DATABASE postgres FROM PUBLIC;

\set database crypto_lending
\set bootstrap_role crypto_admin
\set schema_owner_role crypto_schema_owner
\set migration_role crypto_migration
\set legacy_runtime_role crypto_runtime
\set api_runtime_role crypto_api_runtime
\set worker_runtime_role crypto_worker_runtime
\set balance_consumer_runtime_role crypto_balance_consumer_runtime
\set api_login_prefix crypto_api_login_
\set worker_login_prefix crypto_worker_login_
\set balance_consumer_login_prefix crypto_balance_consumer_login_
\set api_login crypto_api_login_a
\set worker_login crypto_worker_login_a
\set balance_consumer_login crypto_balance_consumer_login_a
\i /opt/crypto-lending/bootstrap-principals.sql
