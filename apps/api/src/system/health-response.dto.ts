import { ApiProperty } from '@nestjs/swagger';

import { SERVICE_NAME } from '../constants';

export class HealthResponseDto {
  @ApiProperty({ example: SERVICE_NAME })
  readonly service = SERVICE_NAME;

  @ApiProperty({ enum: ['ok'], example: 'ok' })
  readonly status = 'ok' as const;
}
