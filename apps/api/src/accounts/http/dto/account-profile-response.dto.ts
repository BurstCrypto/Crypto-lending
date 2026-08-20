import { ApiProperty } from '@nestjs/swagger';

import { ISO_3166_ALPHA_2_CODES, type AccountProfile } from '../../domain/account-profile';

export class AccountProfileResponseDto {
  @ApiProperty({ example: '0f27af0b-48b2-4f1b-b3d4-cd531a0b4458', format: 'uuid' })
  readonly accountId: string;

  @ApiProperty({
    example: 'Case.Sensitive@example.com',
    format: 'email',
    maxLength: 254,
    minLength: 3,
    pattern: '^[!-~]+$',
  })
  readonly contactEmail: string;

  @ApiProperty({
    example: '+14155552671',
    maxLength: 16,
    minLength: 3,
    nullable: true,
    pattern: '^\\+[1-9][0-9]{1,14}$',
    type: String,
  })
  readonly contactPhone: string | null;

  @ApiProperty({
    enum: [...ISO_3166_ALPHA_2_CODES],
    example: 'CA',
    minLength: 2,
    maxLength: 2,
  })
  readonly declaredResidencyCountryCode: string;

  @ApiProperty({ enum: ['UNKNOWN'], example: 'UNKNOWN' })
  readonly eligibilityStatus: 'UNKNOWN';

  @ApiProperty({ example: 1, minimum: 1, type: Number })
  readonly version: number;

  @ApiProperty({ example: '2026-08-20T16:00:00.000Z', format: 'date-time' })
  readonly createdAt: string;

  @ApiProperty({ example: '2026-08-20T16:00:00.000Z', format: 'date-time' })
  readonly updatedAt: string;

  constructor(profile: AccountProfile) {
    this.accountId = profile.accountId;
    this.contactEmail = profile.contactEmail;
    this.contactPhone = profile.contactPhone;
    this.declaredResidencyCountryCode = profile.declaredResidencyCountryCode;
    this.eligibilityStatus = profile.eligibilityStatus;
    this.version = profile.version;
    this.createdAt = profile.createdAt.toISOString();
    this.updatedAt = profile.updatedAt.toISOString();
    Object.freeze(this);
  }
}
