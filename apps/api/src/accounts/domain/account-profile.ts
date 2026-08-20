const ACCOUNT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL_LOCAL_PART_PATTERN = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/u;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
const E164_PHONE_PATTERN = /^\+[1-9][0-9]{1,14}$/u;
const COUNTRY_CODE_INPUT_PATTERN = /^[A-Z]{2}$/u;
const MAX_EMAIL_LENGTH = 254;
const MAX_EMAIL_LOCAL_PART_LENGTH = 64;
const MAX_EMAIL_DOMAIN_LENGTH = 253;
const MAX_PROFILE_VERSION = 2_147_483_647;

// ISO 3166-1 alpha-2 officially assigned codes. User-declared residency is
// deliberately not proof of residency and must not influence eligibility.
export const ISO_3166_ALPHA_2_CODES = Object.freeze([
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
] as const);

const ISO_3166_ALPHA_2_CODE_SET: ReadonlySet<string> = new Set(ISO_3166_ALPHA_2_CODES);

declare const accountIdBrand: unique symbol;

export type AccountId = string & { readonly [accountIdBrand]: 'AccountId' };
export type AccountEligibility = 'UNKNOWN';

export const UNKNOWN_ACCOUNT_ELIGIBILITY: AccountEligibility = 'UNKNOWN';

export type AccountProfileValidationCode =
  | 'INVALID_ACCOUNT_ID'
  | 'INVALID_CONTACT_EMAIL'
  | 'INVALID_CONTACT_PHONE'
  | 'INVALID_DECLARED_RESIDENCY'
  | 'INVALID_PROFILE_VERSION';

export class AccountProfileValidationError extends Error {
  constructor(readonly code: AccountProfileValidationCode) {
    super(code);
    this.name = 'AccountProfileValidationError';
  }
}

export interface AccountProfile {
  readonly accountId: AccountId;
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly declaredResidencyCountryCode: string;
  readonly eligibilityStatus: AccountEligibility;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateAccountProfileInput {
  readonly accountId: AccountId;
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly declaredResidencyCountryCode: string;
}

export interface ProvisionAccountProfileInput {
  readonly contactEmail: string;
  readonly contactPhone: string | null;
  readonly declaredResidencyCountryCode: string;
}

export interface UpdateAccountProfileInput {
  readonly contactEmail?: string;
  readonly contactPhone?: string | null;
  readonly declaredResidencyCountryCode?: string;
}

export function parseAccountId(value: unknown): AccountId {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value)) {
    throw new AccountProfileValidationError('INVALID_ACCOUNT_ID');
  }
  return value as AccountId;
}

export function isAccountId(value: unknown): value is AccountId {
  return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value);
}

function splitEmail(value: string): readonly [localPart: string, domain: string] {
  const separator = value.indexOf('@');
  if (separator <= 0 || separator !== value.lastIndexOf('@') || separator === value.length - 1) {
    throw new AccountProfileValidationError('INVALID_CONTACT_EMAIL');
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

export function normalizeContactEmail(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > MAX_EMAIL_LENGTH ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    throw new AccountProfileValidationError('INVALID_CONTACT_EMAIL');
  }

  const [localPart, domain] = splitEmail(value);
  if (
    localPart.length > MAX_EMAIL_LOCAL_PART_LENGTH ||
    !EMAIL_LOCAL_PART_PATTERN.test(localPart) ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..') ||
    domain.length > MAX_EMAIL_DOMAIN_LENGTH ||
    domain.startsWith('.') ||
    domain.endsWith('.')
  ) {
    throw new AccountProfileValidationError('INVALID_CONTACT_EMAIL');
  }

  const labels = domain.split('.');
  if (labels.some((label) => !EMAIL_DOMAIN_LABEL_PATTERN.test(label))) {
    throw new AccountProfileValidationError('INVALID_CONTACT_EMAIL');
  }

  return `${localPart}@${domain.toLowerCase()}`;
}

export function isValidContactEmail(value: unknown): value is string {
  try {
    normalizeContactEmail(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeContactPhone(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !E164_PHONE_PATTERN.test(value)) {
    throw new AccountProfileValidationError('INVALID_CONTACT_PHONE');
  }
  return value;
}

export function isValidContactPhone(value: unknown): value is string | null | undefined {
  try {
    normalizeContactPhone(value);
    return true;
  } catch {
    return false;
  }
}

export function normalizeDeclaredResidencyCountryCode(value: unknown): string {
  if (typeof value !== 'string' || !COUNTRY_CODE_INPUT_PATTERN.test(value)) {
    throw new AccountProfileValidationError('INVALID_DECLARED_RESIDENCY');
  }
  if (!ISO_3166_ALPHA_2_CODE_SET.has(value)) {
    throw new AccountProfileValidationError('INVALID_DECLARED_RESIDENCY');
  }
  return value;
}

export function isValidDeclaredResidencyCountryCode(value: unknown): value is string {
  try {
    normalizeDeclaredResidencyCountryCode(value);
    return true;
  } catch {
    return false;
  }
}

export function assertValidProfileVersion(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_PROFILE_VERSION
  ) {
    throw new AccountProfileValidationError('INVALID_PROFILE_VERSION');
  }
  return value as number;
}
