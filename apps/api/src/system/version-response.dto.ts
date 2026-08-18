import { ApiProperty } from '@nestjs/swagger';

import { API_VERSION, SERVICE_NAME, SERVICE_VERSION } from '../constants';

export class VersionResponseDto {
  @ApiProperty({ example: API_VERSION })
  readonly apiVersion = API_VERSION;

  @ApiProperty({ example: SERVICE_NAME })
  readonly service = SERVICE_NAME;

  @ApiProperty({ example: SERVICE_VERSION })
  readonly serviceVersion = SERVICE_VERSION;
}
