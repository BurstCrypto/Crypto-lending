import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class StartRegistrationDto {
  @ApiProperty({ example: 'trey@example.com', maxLength: 254 })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  contactEmail!: string;

  @ApiPropertyOptional({ example: '+13035550123', nullable: true, type: String })
  @Transform(({ value }: { value: unknown }) => (value === '' ? undefined : value))
  @IsOptional()
  @Matches(/^\+[1-9][0-9]{1,14}$/u)
  contactPhone?: string | null;

  @ApiProperty({ example: 'US', minLength: 2, maxLength: 2 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^[A-Za-z]{2}$/u.test(value) ? value.toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/u)
  declaredResidencyCountryCode!: string;

  @ApiPropertyOptional({ example: '/', default: '/' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  returnPath?: string;
}
