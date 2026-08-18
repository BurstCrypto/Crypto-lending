import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { InfrastructureHealthResponseDto } from './infrastructure-health-response.dto';
import { InfrastructureHealthService } from './infrastructure-health.service';

@ApiTags('system')
@Controller('health')
export class InfrastructureHealthController {
  constructor(private readonly health: InfrastructureHealthService) {}

  @Get('dependencies')
  @ApiOperation({ summary: 'Report required dependency readiness' })
  @ApiOkResponse({
    description: 'All required dependencies are reachable and correctly configured.',
    type: InfrastructureHealthResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'At least one required dependency is unavailable or misconfigured.',
    type: InfrastructureHealthResponseDto,
  })
  async checkDependencies(): Promise<InfrastructureHealthResponseDto> {
    const health = await this.health.check();
    const response: InfrastructureHealthResponseDto = {
      status: health.status,
      checks: {
        postgres: {
          status: health.checks.postgres.status,
          latencyMs: health.checks.postgres.latencyMs,
        },
        redis: {
          status: health.checks.redis.status,
          latencyMs: health.checks.redis.latencyMs,
        },
        sqs: {
          status: health.checks.sqs.status,
          latencyMs: health.checks.sqs.latencyMs,
        },
      },
    };

    if (response.status === 'degraded') {
      throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return response;
  }
}
