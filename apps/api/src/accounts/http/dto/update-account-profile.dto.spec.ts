import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { UpdateAccountProfileDto } from './update-account-profile.dto';

const pipe = new ValidationPipe({
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transform: true,
  whitelist: true,
});

async function transform(value: unknown): Promise<UpdateAccountProfileDto> {
  return pipe.transform(value, {
    data: '',
    metatype: UpdateAccountProfileDto,
    type: 'body',
  }) as Promise<UpdateAccountProfileDto>;
}

describe('UpdateAccountProfileDto', () => {
  it('canonicalizes only permitted profile fields', async () => {
    await expect(
      transform({
        contactEmail: 'Case.Sensitive@EXAMPLE.COM',
        contactPhone: null,
        declaredResidencyCountryCode: 'CA',
      }),
    ).resolves.toMatchObject({
      contactEmail: 'Case.Sensitive@example.com',
      contactPhone: null,
      declaredResidencyCountryCode: 'CA',
    });
  });

  it.each([
    null,
    [],
    'contactEmail=user@example.com',
    { contactEmail: null },
    { declaredResidencyCountryCode: null },
    { contactEmail: ' user@example.com' },
    { contactEmail: 'user\r\n@example.com' },
    { contactEmail: 'usér@example.com' },
    { contactPhone: '14155552671' },
    { contactPhone: '+1 415 555 2671' },
    { declaredResidencyCountryCode: 'UK' },
    { declaredResidencyCountryCode: 'ca' },
    { declaredResidencyCountryCode: 'UЅ' },
    { declaredResidencyCountryCode: ['US'] },
    { accountId: '0f27af0b-48b2-4f1b-b3d4-cd531a0b4458' },
    { eligibilityStatus: 'ELIGIBLE' },
    { version: 2 },
    { createdAt: '2026-08-20T00:00:00.000Z' },
    { hasUpdate: true },
    { profileUpdateShape: {} },
    { contactEmail: 'user@example.com', unexpected: true },
    { contactEmail: { constructor: 'user@example.com' } },
  ])('rejects empty, null, unknown, privileged, and adversarial shapes', async (value) => {
    await expect(transform(value)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty permitted update before constructing a domain command', async () => {
    await expect(transform({})).rejects.toBeInstanceOf(BadRequestException);
    expect(() => new UpdateAccountProfileDto().toInput()).toThrow(BadRequestException);
  });

  it('does not accept prototype-derived permitted values', async () => {
    const payload = Object.create({ contactEmail: 'attacker@example.com' }) as object;
    await expect(transform(payload)).rejects.toBeInstanceOf(BadRequestException);
  });
});
