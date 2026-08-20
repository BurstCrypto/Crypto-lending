import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthResponseDto } from './health-response.dto';

@ApiTags('system')
@Controller('health')
export class HealthController {
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Report API process health' })
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth(): HealthResponseDto {
    return new HealthResponseDto();
  }
}
