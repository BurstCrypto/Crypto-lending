import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  Validate,
  ValidateBy,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiPropertyOptional, type SchemaObject } from '@nestjs/swagger';

import {
  ISO_3166_ALPHA_2_CODES,
  isValidContactEmail,
  isValidContactPhone,
  isValidDeclaredResidencyCountryCode,
  normalizeContactEmail,
  normalizeContactPhone,
  normalizeDeclaredResidencyCountryCode,
  type UpdateAccountProfileInput,
} from '../../domain/account-profile';

export const UPDATE_ACCOUNT_PROFILE_OPENAPI_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  maxProperties: 3,
  properties: {
    contactEmail: {
      type: 'string',
      format: 'email',
      minLength: 3,
      maxLength: 254,
      pattern: '^[!-~]+$',
      description: 'Printable ASCII email; the local part is preserved and the domain is lowercase',
      example: 'Case.Sensitive@example.com',
    },
    contactPhone: {
      type: 'string',
      nullable: true,
      minLength: 3,
      maxLength: 16,
      pattern: '^\\+[1-9][0-9]{1,14}$',
      description: 'Canonical E.164 syntax or null to clear the unverified contact number',
      example: '+14155552671',
    },
    declaredResidencyCountryCode: {
      type: 'string',
      minLength: 2,
      maxLength: 2,
      enum: [...ISO_3166_ALPHA_2_CODES],
      description: 'Unverified, officially assigned ISO 3166-1 alpha-2 declaration',
      example: 'CA',
    },
  },
};

function normalizeIfValid(
  value: unknown,
  normalize: (candidate: unknown) => string | null | undefined,
): unknown {
  try {
    return normalize(value);
  } catch {
    return value;
  }
}

function IsAccountContactEmail(): PropertyDecorator {
  return ValidateBy({
    name: 'isAccountContactEmail',
    validator: {
      defaultMessage: (): string => 'contactEmail must be a valid ASCII email address',
      validate: (value: unknown): boolean => isValidContactEmail(value),
    },
  });
}

function IsCanonicalE164Phone(): PropertyDecorator {
  return ValidateBy({
    name: 'isCanonicalE164Phone',
    validator: {
      defaultMessage: (): string => 'contactPhone must be a canonical E.164 phone number',
      validate: (value: unknown): boolean =>
        value === null || (typeof value === 'string' && isValidContactPhone(value)),
    },
  });
}

function IsAssignedCountryCode(): PropertyDecorator {
  return ValidateBy({
    name: 'isAssignedCountryCode',
    validator: {
      defaultMessage: (): string =>
        'declaredResidencyCountryCode must be an assigned ISO 3166-1 alpha-2 code',
      validate: (value: unknown): boolean => isValidDeclaredResidencyCountryCode(value),
    },
  });
}

const PROFILE_UPDATE_SHAPE_TOKEN = Object.freeze({});

@ValidatorConstraint({ name: 'hasProfileUpdate', async: false })
class HasProfileUpdateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, arguments_: ValidationArguments): boolean {
    const candidate = arguments_.object as UpdateAccountProfileDto;
    return (
      value === PROFILE_UPDATE_SHAPE_TOKEN &&
      (candidate.contactEmail !== undefined ||
        candidate.contactPhone !== undefined ||
        candidate.declaredResidencyCountryCode !== undefined)
    );
  }

  defaultMessage(): string {
    return 'at least one permitted profile field is required';
  }
}

export class UpdateAccountProfileDto {
  @Validate(HasProfileUpdateConstraint)
  private readonly profileUpdateShape = PROFILE_UPDATE_SHAPE_TOKEN;

  @ApiPropertyOptional({
    description: 'Printable ASCII email; the local part is preserved and the domain is lowercase',
    example: 'Case.Sensitive@example.com',
    format: 'email',
    maxLength: 254,
    minLength: 3,
    pattern: '^[!-~]+$',
  })
  @Transform(({ value }: { value: unknown }) => normalizeIfValid(value, normalizeContactEmail))
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsAccountContactEmail()
  readonly contactEmail?: string;

  @ApiPropertyOptional({
    example: '+14155552671',
    minLength: 3,
    maxLength: 16,
    nullable: true,
    pattern: '^\\+[1-9][0-9]{1,14}$',
    type: String,
  })
  @Transform(({ value }: { value: unknown }) => normalizeIfValid(value, normalizeContactPhone))
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsCanonicalE164Phone()
  readonly contactPhone?: string | null;

  @ApiPropertyOptional({
    description: 'Unverified, officially assigned ISO 3166-1 alpha-2 declaration',
    enum: [...ISO_3166_ALPHA_2_CODES],
    example: 'CA',
    minLength: 2,
    maxLength: 2,
  })
  @Transform(({ value }: { value: unknown }) =>
    normalizeIfValid(value, normalizeDeclaredResidencyCountryCode),
  )
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsAssignedCountryCode()
  readonly declaredResidencyCountryCode?: string;

  toInput(): UpdateAccountProfileInput {
    const input: UpdateAccountProfileInput = Object.freeze({
      ...(this.contactEmail === undefined ? {} : { contactEmail: this.contactEmail }),
      ...(this.contactPhone === undefined ? {} : { contactPhone: this.contactPhone }),
      ...(this.declaredResidencyCountryCode === undefined
        ? {}
        : { declaredResidencyCountryCode: this.declaredResidencyCountryCode }),
    });
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one permitted profile field is required');
    }
    return input;
  }
}
