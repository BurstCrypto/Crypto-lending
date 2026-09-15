import { passwordlessDestination } from '../application/passwordless.service';
import { AuthenticationRejectedError } from '../application/authentication.errors';

describe('U.S. passwordless phone destinations', () => {
  it.each(['2025550123', '(202) 555-0123', '1 (202) 555-0123', '+12025550123'])(
    'normalizes %s to one identity',
    (value) => {
      expect(passwordlessDestination(value)).toEqual({
        channel: 'sms',
        destination: '+12025550123',
      });
    },
  );

  it.each([
    '+14165550123', // Canada also uses +1.
    '+12425550123', // Bahamas also uses +1.
    '+17875550123', // Puerto Rico is a separate numbering region.
    '+442079460123',
    '+15551234567',
    '+18005550123', // Non-geographic toll-free number.
    '2025550123 ext 123',
    'Call +12025550123',
    '',
  ])('rejects unsupported or invalid destination %s', (value) => {
    expect(() => passwordlessDestination(value)).toThrow(AuthenticationRejectedError);
  });

  it('preserves email sign-in normalization', () => {
    expect(passwordlessDestination(' Person@Example.test ')).toEqual({
      channel: 'email',
      destination: 'person@example.test',
    });
  });
});
