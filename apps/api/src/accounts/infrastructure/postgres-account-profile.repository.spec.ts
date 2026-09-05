import type { QueryResult, QueryResultRow } from 'pg';

import type { PostgresService } from '../../infrastructure/database/postgres.service';
import { parseAccountId } from '../domain/account-profile';
import {
  AccountProfilePersistenceError,
  PostgresAccountProfileRepository,
} from './postgres-account-profile.repository';

const accountId = parseAccountId('7b119930-99b8-4f32-960a-723ffa216e01');

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function profileRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    account_id: accountId,
    contact_email: 'account@example.test',
    contact_phone: '+12025550123',
    declared_residency_country_code: 'CA',
    eligibility_status: 'UNKNOWN',
    version: 1,
    created_at: new Date('2026-08-20T12:00:00.000Z'),
    updated_at: new Date('2026-08-20T12:00:00.000Z'),
    ...overrides,
  };
}

function setup(): {
  query: jest.Mock;
  repository: PostgresAccountProfileRepository;
} {
  const query = jest.fn();
  const postgres = { query } as unknown as PostgresService;
  return { query, repository: new PostgresAccountProfileRepository(postgres) };
}

describe('PostgresAccountProfileRepository', () => {
  it('looks up only the principal account through a fixed parameterized query', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([profileRow()]));

    await expect(repository.findByAccountId(accountId)).resolves.toMatchObject({
      accountId,
      contactEmail: 'account@example.test',
      eligibilityStatus: 'UNKNOWN',
      version: 1,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE profile.account_id = $1');
    expect(sql).toMatch(/WHERE profile\.account_id = \$1\s+LIMIT 2/u);
    expect(sql).not.toContain(accountId);
    expect(values).toEqual([accountId]);
  });

  it('returns null only for an unambiguous empty account-scoped result', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([]));

    await expect(repository.findByAccountId(accountId)).resolves.toBeNull();
  });

  it('fails closed instead of selecting from an ambiguous profile result', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([profileRow(), profileRow()]));

    await expect(repository.findByAccountId(accountId)).rejects.toEqual(
      expect.objectContaining({
        name: 'AccountProfilePersistenceError',
        message: 'Account profile persistence operation failed',
      }),
    );
  });

  it('fails closed when storage returns another account profile', async () => {
    const { query, repository } = setup();
    const otherAccountId = parseAccountId('78d5e055-c37e-48df-a566-07ce3e8af195');
    query.mockResolvedValue(
      result([
        profileRow({
          account_id: otherAccountId,
          contact_email: 'other-account@example.test',
        }),
      ]),
    );

    let thrown: unknown;
    try {
      await repository.findByAccountId(accountId);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AccountProfilePersistenceError);
    expect(String(thrown)).not.toContain(otherAccountId);
    expect(String(thrown)).not.toContain('other-account@example.test');
  });

  it('provisions only through the fixed security-definer boundary', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(result([profileRow()]));

    await expect(
      repository.provisionForAccount(
        {
          accountId,
          contactEmail: 'account@example.test',
          contactPhone: '+12025550123',
          declaredResidencyCountryCode: 'CA',
        },
        { actorAccountId: accountId, correlationId: 'request:kan36-provision' },
      ),
    ).resolves.toMatchObject({ accountId, eligibilityStatus: 'UNKNOWN', version: 1 });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM provision_account_profile(');
    expect(sql).toContain('$1::uuid');
    expect(sql).toContain('$6::text');
    expect(sql).toMatch(/AS provisioned\s+LIMIT 2/u);
    expect(sql).not.toMatch(/\bINSERT\b|\bUPDATE\b|account_profile_audit/iu);
    expect(sql).not.toContain('account@example.test');
    expect(values).toEqual([
      accountId,
      'account@example.test',
      '+12025550123',
      'CA',
      accountId,
      'request:kan36-provision',
    ]);
  });

  it('rejects ambiguous or cross-account provisioning results without leaking profile data', async () => {
    const { query, repository } = setup();
    const input = {
      accountId,
      contactEmail: 'account@example.test',
      contactPhone: '+12025550123',
      declaredResidencyCountryCode: 'CA',
    };
    const audit = { actorAccountId: accountId, correlationId: 'request:kan36-provision' };

    query.mockResolvedValueOnce(result([profileRow(), profileRow()]));
    await expect(repository.provisionForAccount(input, audit)).rejects.toBeInstanceOf(
      AccountProfilePersistenceError,
    );

    const otherAccountId = parseAccountId('78d5e055-c37e-48df-a566-07ce3e8af195');
    query.mockResolvedValueOnce(
      result([
        profileRow({
          account_id: otherAccountId,
          contact_email: 'other-account@example.test',
        }),
      ]),
    );
    let thrown: unknown;
    try {
      await repository.provisionForAccount(input, audit);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AccountProfilePersistenceError);
    expect(String(thrown)).not.toContain(otherAccountId);
    expect(String(thrown)).not.toContain('other-account@example.test');
  });

  it('updates only through the fixed security-definer boundary', async () => {
    const { query, repository } = setup();
    query.mockResolvedValue(
      result([
        profileRow({
          outcome: 'updated',
          contact_email: 'new@example.test',
          contact_phone: null,
          version: 2,
          updated_at: new Date('2026-08-20T12:01:00.000Z'),
        }),
      ]),
    );

    await expect(
      repository.update(
        accountId,
        1,
        { contactEmail: 'new@example.test', contactPhone: null },
        { actorAccountId: accountId, correlationId: 'request:kan36-1' },
      ),
    ).resolves.toMatchObject({ status: 'updated', profile: { version: 2 } });

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM update_account_profile(');
    expect(sql).toContain('$1::uuid');
    expect(sql).toContain('$2::integer');
    expect(sql).toContain('$10::text');
    expect(sql).toMatch(/AS updated\s+LIMIT 2/u);
    expect(sql).not.toMatch(/\bINSERT\b|\bUPDATE\b|account_profile_audit/iu);
    expect(sql).not.toContain('new@example.test');
    expect(values).toEqual([
      accountId,
      1,
      true,
      'new@example.test',
      true,
      null,
      false,
      null,
      accountId,
      'request:kan36-1',
    ]);
  });

  it('rejects ambiguous or cross-account successful update results', async () => {
    const { query, repository } = setup();
    const updated = profileRow({ outcome: 'updated', version: 2 });
    const update = (): ReturnType<PostgresAccountProfileRepository['update']> =>
      repository.update(
        accountId,
        1,
        { declaredResidencyCountryCode: 'GB' },
        { actorAccountId: accountId, correlationId: 'request:kan36-update-hostile' },
      );

    query.mockResolvedValueOnce(result([updated, updated]));
    await expect(update()).rejects.toBeInstanceOf(AccountProfilePersistenceError);

    const otherAccountId = parseAccountId('78d5e055-c37e-48df-a566-07ce3e8af195');
    query.mockResolvedValueOnce(
      result([
        profileRow({
          outcome: 'updated',
          account_id: otherAccountId,
          contact_email: 'other-account@example.test',
          version: 2,
        }),
      ]),
    );
    let thrown: unknown;
    try {
      await update();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AccountProfilePersistenceError);
    expect(String(thrown)).not.toContain(otherAccountId);
    expect(String(thrown)).not.toContain('other-account@example.test');
  });

  it.each(['stale', 'not-found'] as const)(
    'preserves the deliberate %s result',
    async (outcome) => {
      const { query, repository } = setup();
      query.mockResolvedValue(
        result([
          {
            outcome,
            account_id: null,
            contact_email: null,
            contact_phone: null,
            declared_residency_country_code: null,
            eligibility_status: null,
            version: null,
            created_at: null,
            updated_at: null,
          },
        ]),
      );

      await expect(
        repository.update(
          accountId,
          1,
          { declaredResidencyCountryCode: 'GB' },
          { actorAccountId: accountId, correlationId: 'request:kan36-2' },
        ),
      ).resolves.toEqual({ status: outcome });
    },
  );

  it.each(['stale', 'not-found'] as const)(
    'rejects a %s result that carries profile material',
    async (outcome) => {
      const { query, repository } = setup();
      query.mockResolvedValue(
        result([
          {
            outcome,
            account_id: accountId,
            contact_email: 'other-account@example.test',
            contact_phone: null,
            declared_residency_country_code: null,
            eligibility_status: null,
            version: null,
            created_at: null,
            updated_at: null,
          },
        ]),
      );

      let thrown: unknown;
      try {
        await repository.update(
          accountId,
          1,
          { declaredResidencyCountryCode: 'GB' },
          { actorAccountId: accountId, correlationId: 'request:kan36-no-profile-material' },
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AccountProfilePersistenceError);
      expect(String(thrown)).not.toContain('other-account@example.test');
    },
  );

  it('does not propagate PostgreSQL messages, detail, parameters, or cause', async () => {
    const { query, repository } = setup();
    query.mockRejectedValue(
      Object.assign(new Error('duplicate contact account@example.test'), {
        detail: 'Key (contact_email)=(account@example.test) already exists.',
        constraint: 'secret_contact_constraint',
        query: 'SELECT account@example.test',
      }),
    );

    let thrown: unknown;
    try {
      await repository.findByAccountId(accountId);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AccountProfilePersistenceError);
    expect(thrown).toMatchObject({ message: 'Account profile persistence operation failed' });
    expect(thrown).not.toHaveProperty('cause');
    expect(thrown).not.toHaveProperty('detail');
    expect(thrown).not.toHaveProperty('constraint');
    expect(String(thrown)).not.toContain('account@example.test');
  });
});
