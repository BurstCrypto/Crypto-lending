import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/** +1 also includes Canada and Caribbean countries; require the U.S. numbering region. */
export function normalizePasswordlessPhone(value: string): string {
  const phone = parsePhoneNumberFromString(value, { defaultCountry: 'US', extract: false });
  if (
    !phone ||
    phone.country !== 'US' ||
    !phone.isValid() ||
    phone.ext ||
    phone.getType() === 'TOLL_FREE'
  ) {
    throw new Error('Enter a valid U.S. phone number');
  }
  return phone.number;
}
