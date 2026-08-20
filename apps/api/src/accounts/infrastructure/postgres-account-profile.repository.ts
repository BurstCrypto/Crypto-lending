import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { PostgresService } from '../../infrastructure/database/postgres.service';
import type {
  AccountProfileAuditContext,
  AccountProfileRepository,
  AccountProfileUpdateResult,
} from '../application/account-profile.repository.port';
import {
  assertValidProfileVersion,
  normalizeContactEmail,
  normalizeContactPhone,
  normalizeDeclaredResidencyCountryCode,
  parseAccountId,
  UNKNOWN_ACCOUNT_ELIGIBILITY,
  type AccountId,
  type AccountProfile,
  type CreateAccountProfileInput,
  type UpdateAccountProfileInput,
} from '../domain/account-profile';

const AUDIT_CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
interface AccountProfileRow extends QueryResultRow {
  account_id: string;
  contact_email: string;
  contact_phone: string | null;
  declared_residency_country_code: string;
  eligibility_status: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface AccountProfileUpdateRow extends QueryResultRow {
  outcome: 'updated' | 'not-found' | 'stale';
  account_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  declared_residency_country_code: string | null;
  eligibility_status: string | null;
  version: number | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export class AccountProfilePersistenceError extends Error {
  constructor() {
    super('Account profile persistence operation failed');
    this.name = 'AccountProfilePersistenceError';
  }
}

function assertAuditContext(context: AccountProfileAuditContext): {
  actorAccountId: AccountId;
  correlationId: string;
} {
  const actorAccountId = parseAccountId(context.actorAccountId);
  if (!AUDIT_CORRELATION_PATTERN.test(context.correlationId)) {
    throw new AccountProfilePersistenceError();
  }
  return { actorAccountId, correlationId: context.correlationId };
}

function mapProfile(row: AccountProfileRow): AccountProfile {
  if (
    row.eligibility_status !== UNKNOWN_ACCOUNT_ELIGIBILITY ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1 ||
    !(row.created_at instanceof Date) ||
    !Number.isFinite(row.created_at.getTime()) ||
    !(row.updated_at instanceof Date) ||
    !Number.isFinite(row.updated_at.getTime())
  ) {
    throw new AccountProfilePersistenceError();
  }

  const contactEmail = normalizeContactEmail(row.contact_email);
  const contactPhone =
    row.contact_phone === null ? null : (normalizeContactPhone(row.contact_phone) ?? null);
  if (row.contact_phone !== null && contactPhone === null) {
    throw new AccountProfilePersistenceError();
  }

  return {
    accountId: parseAccountId(row.account_id),
    contactEmail,
    contactPhone,
    declaredResidencyCountryCode: normalizeDeclaredResidencyCountryCode(
      row.declared_residency_country_code,
    ),
    eligibilityStatus: UNKNOWN_ACCOUNT_ELIGIBILITY,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function profileFromUpdateRow(row: AccountProfileUpdateRow): AccountProfile {
  if (
    row.account_id === null ||
    row.contact_email === null ||
    row.declared_residency_country_code === null ||
    row.eligibility_status === null ||
    row.version === null ||
    row.created_at === null ||
    row.updated_at === null
  ) {
    throw new AccountProfilePersistenceError();
  }
  return mapProfile({
    account_id: row.account_id,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    declared_residency_country_code: row.declared_residency_country_code,
    eligibility_status: row.eligibility_status,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

@Injectable()
export class PostgresAccountProfileRepository implements AccountProfileRepository {
  constructor(private readonly postgres: PostgresService) {}

  async findByAccountId(accountId: AccountId): Promise<AccountProfile | null> {
    try {
      const result = await this.postgres.query<AccountProfileRow>(
        `SELECT profile.account_id,
                profile.contact_email,
                profile.contact_phone,
                profile.declared_residency_country_code,
                account.eligibility_status,
                profile.version,
                profile.created_at,
                profile.updated_at
         FROM account_profiles AS profile
         INNER JOIN accounts AS account ON account.account_id = profile.account_id
         WHERE profile.account_id = $1`,
        [parseAccountId(accountId)],
      );
      const row = result.rows[0];
      return row ? mapProfile(row) : null;
    } catch {
      throw new AccountProfilePersistenceError();
    }
  }

  async provisionForAccount(
    input: CreateAccountProfileInput,
    auditContext: AccountProfileAuditContext,
  ): Promise<AccountProfile> {
    const accountId = parseAccountId(input.accountId);
    const actor = assertAuditContext(auditContext);
    const contactEmail = normalizeContactEmail(input.contactEmail);
    const contactPhone = normalizeContactPhone(input.contactPhone) ?? null;
    const countryCode = normalizeDeclaredResidencyCountryCode(input.declaredResidencyCountryCode);

    try {
      const result = await this.postgres.query<AccountProfileRow>(
        `SELECT provisioned.profile_account_id AS account_id,
                provisioned.profile_contact_email AS contact_email,
                provisioned.profile_contact_phone AS contact_phone,
                provisioned.profile_residency_country_code AS declared_residency_country_code,
                provisioned.account_eligibility_status AS eligibility_status,
                provisioned.profile_version AS version,
                provisioned.profile_created_at AS created_at,
                provisioned.profile_updated_at AS updated_at
         FROM provision_account_profile(
           $1::uuid,
           $2::text,
           $3::text,
           $4::text,
           $5::uuid,
           $6::text
         ) AS provisioned`,
        [
          accountId,
          contactEmail,
          contactPhone,
          countryCode,
          actor.actorAccountId,
          actor.correlationId,
        ],
      );
      const row = result.rows[0];
      if (!row || result.rows.length !== 1) {
        throw new AccountProfilePersistenceError();
      }
      return mapProfile(row);
    } catch {
      throw new AccountProfilePersistenceError();
    }
  }

  async update(
    accountId: AccountId,
    expectedVersion: number,
    input: UpdateAccountProfileInput,
    auditContext: AccountProfileAuditContext,
  ): Promise<AccountProfileUpdateResult> {
    const normalizedAccountId = parseAccountId(accountId);
    const version = assertValidProfileVersion(expectedVersion);
    const actor = assertAuditContext(auditContext);
    const hasContactEmail = input.contactEmail !== undefined;
    const hasContactPhone = input.contactPhone !== undefined;
    const hasCountryCode = input.declaredResidencyCountryCode !== undefined;
    const changedFields = [
      ...(hasContactEmail ? ['contactEmail'] : []),
      ...(hasContactPhone ? ['contactPhone'] : []),
      ...(hasCountryCode ? ['declaredResidencyCountryCode'] : []),
    ];
    if (changedFields.length === 0) {
      throw new AccountProfilePersistenceError();
    }

    const contactEmail = hasContactEmail ? normalizeContactEmail(input.contactEmail) : null;
    const contactPhone = hasContactPhone
      ? (normalizeContactPhone(input.contactPhone) ?? null)
      : null;
    const countryCode = hasCountryCode
      ? normalizeDeclaredResidencyCountryCode(input.declaredResidencyCountryCode)
      : null;

    try {
      const result = await this.postgres.query<AccountProfileUpdateRow>(
        `SELECT updated.update_outcome AS outcome,
                updated.profile_account_id AS account_id,
                updated.profile_contact_email AS contact_email,
                updated.profile_contact_phone AS contact_phone,
                updated.profile_residency_country_code AS declared_residency_country_code,
                updated.account_eligibility_status AS eligibility_status,
                updated.profile_version AS version,
                updated.profile_created_at AS created_at,
                updated.profile_updated_at AS updated_at
         FROM update_account_profile(
           $1::uuid,
           $2::integer,
           $3::boolean,
           $4::text,
           $5::boolean,
           $6::text,
           $7::boolean,
           $8::text,
           $9::uuid,
           $10::text
         ) AS updated`,
        [
          normalizedAccountId,
          version,
          hasContactEmail,
          contactEmail,
          hasContactPhone,
          contactPhone,
          hasCountryCode,
          countryCode,
          actor.actorAccountId,
          actor.correlationId,
        ],
      );
      const row = result.rows[0];
      if (!row || result.rows.length !== 1) {
        throw new AccountProfilePersistenceError();
      }
      if (row.outcome === 'stale' || row.outcome === 'not-found') {
        return { status: row.outcome };
      }
      if (row.outcome !== 'updated') {
        throw new AccountProfilePersistenceError();
      }
      return { status: 'updated', profile: profileFromUpdateRow(row) };
    } catch {
      throw new AccountProfilePersistenceError();
    }
  }
}
