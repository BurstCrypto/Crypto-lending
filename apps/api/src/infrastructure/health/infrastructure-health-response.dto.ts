import { ApiProperty } from '@nestjs/swagger';

export class PublicDependencyHealthCheckDto {
  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  status!: 'up' | 'down';

  @ApiProperty({ example: 2, minimum: 0 })
  latencyMs!: number;
}

export class PublicDependencyChecksDto {
  @ApiProperty({ type: PublicDependencyHealthCheckDto })
  postgres!: PublicDependencyHealthCheckDto;

  @ApiProperty({ type: PublicDependencyHealthCheckDto })
  redis!: PublicDependencyHealthCheckDto;

  @ApiProperty({ type: PublicDependencyHealthCheckDto })
  sqs!: PublicDependencyHealthCheckDto;
}

export class InfrastructureHealthResponseDto {
  @ApiProperty({ enum: ['ok', 'degraded'], example: 'ok' })
  status!: 'ok' | 'degraded';

  @ApiProperty({ type: PublicDependencyChecksDto })
  checks!: PublicDependencyChecksDto;
}
