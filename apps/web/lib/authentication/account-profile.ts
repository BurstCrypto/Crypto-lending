import { AuthenticationUnavailableError } from './errors';

const PROFILE_KEYS = new Set([
  'accountId',
  'contactEmail',
  'contactPhone',
  'declaredResidencyCountryCode',
  'eligibilityStatus',
  'version',
  'createdAt',
  'updatedAt',
]);
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL_LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/u;
const EMAIL_DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
const E164_PHONE = /^\+[1-9][0-9]{1,14}$/u;
const CANONICAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ASSIGNED_COUNTRY_CODES = new Set(
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' ',
  ),
);

export interface AccountProfile {
  readonly accountId: string;
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly declaredResidencyCountryCode: string;
  readonly eligibilityStatus: 'UNKNOWN';
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function fail(): never {
  throw new AuthenticationUnavailableError();
}

function exactDataRecord(value: unknown): Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return fail();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).some(
        (key) => typeof key !== 'string' || !PROFILE_KEYS.has(key),
      ) ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor)) ||
      Object.keys(descriptors).length !== PROFILE_KEYS.size
    ) {
      return fail();
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [
        key,
        'value' in descriptor ? descriptor.value : undefined,
      ]),
    );
  } catch (error) {
    if (error instanceof AuthenticationUnavailableError) throw error;
    return fail();
  }
}

function validEmail(value: unknown, requireCanonicalDomain: boolean): value is string {
  if (typeof value !== 'string' || value.length < 3 || value.length > 254) return false;
  const separator = value.indexOf('@');
  if (separator <= 0 || separator !== value.lastIndexOf('@') || separator === value.length - 1) {
    return false;
  }
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  return (
    local.length <= 64 &&
    EMAIL_LOCAL_PART.test(local) &&
    !local.startsWith('.') &&
    !local.endsWith('.') &&
    !local.includes('..') &&
    domain.length <= 253 &&
    !domain.startsWith('.') &&
    !domain.endsWith('.') &&
    domain.split('.').every((label) => EMAIL_DOMAIN_LABEL.test(label)) &&
    (!requireCanonicalDomain || domain === domain.toLowerCase())
  );
}

export function isValidContactEmailInput(value: unknown): value is string {
  return validEmail(value, false);
}

export function isAssignedCountryCode(value: unknown): value is string {
  return typeof value === 'string' && ASSIGNED_COUNTRY_CODES.has(value);
}

function canonicalDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_DATE_TIME.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function parseAccountProfile(value: unknown): AccountProfile {
  const record = exactDataRecord(value);
  if (
    typeof record.accountId !== 'string' ||
    !ACCOUNT_ID.test(record.accountId) ||
    !validEmail(record.contactEmail, true) ||
    (record.contactPhone !== null &&
      (typeof record.contactPhone !== 'string' || !E164_PHONE.test(record.contactPhone))) ||
    !isAssignedCountryCode(record.declaredResidencyCountryCode) ||
    record.eligibilityStatus !== 'UNKNOWN' ||
    typeof record.version !== 'number' ||
    !Number.isInteger(record.version) ||
    record.version < 1 ||
    record.version > 2_147_483_647 ||
    !canonicalDateTime(record.createdAt) ||
    !canonicalDateTime(record.updatedAt) ||
    Date.parse(record.updatedAt) < Date.parse(record.createdAt)
  ) {
    return fail();
  }

  return Object.freeze({
    accountId: record.accountId,
    contactEmail: record.contactEmail,
    contactPhone: record.contactPhone,
    declaredResidencyCountryCode: record.declaredResidencyCountryCode,
    eligibilityStatus: record.eligibilityStatus,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}
