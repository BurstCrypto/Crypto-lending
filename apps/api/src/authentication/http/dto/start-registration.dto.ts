import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class StartRegistrationDto {
  @ApiProperty({ example: 'trey@example.com', maxLength: 254 })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  contactEmail!: string;

  @ApiPropertyOptional({ example: '+13035550123', nullable: true })
  @IsOptional()
  @Matches(/^\+[1-9][0-9]{1,14}$/u)
  contactPhone?: string | null;

  @ApiProperty({ example: 'US', minLength: 2, maxLength: 2 })
  @Matches(/^[A-Z]{2}$/u)
  declaredResidencyCountryCode!: string;

  @ApiPropertyOptional({ example: '/', default: '/' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  returnPath?: string;
}
