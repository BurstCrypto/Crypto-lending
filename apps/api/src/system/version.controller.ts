import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { VersionResponseDto } from './version-response.dto';

@ApiTags('system')
@Controller('version')
export class VersionController {
  @Get()
  @ApiOperation({ summary: 'Report API contract and service versions' })
  @ApiOkResponse({ type: VersionResponseDto })
  getVersion(): VersionResponseDto {
    return new VersionResponseDto();
  }
}
