import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { InfrastructureHealthResponseDto } from './infrastructure-health-response.dto';
import { InfrastructureHealthService } from './infrastructure-health.service';
import { ReadinessAbuseInterceptor } from './readiness-abuse.interceptor';

export async function resolveInfrastructureHealthResponse(
  healthService: Pick<InfrastructureHealthService, 'check'>,
): Promise<InfrastructureHealthResponseDto> {
  const health = await healthService.check();
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

@ApiTags('system')
@Controller('health')
export class InfrastructureHealthController {
  constructor(private readonly health: InfrastructureHealthService) {}

  @Get('dependencies')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(ReadinessAbuseInterceptor)
  @ApiOperation({ summary: 'Report required dependency readiness' })
  @ApiOkResponse({
    description: 'All required dependencies are reachable and correctly configured.',
    type: InfrastructureHealthResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'At least one required dependency is unavailable or misconfigured.',
    type: InfrastructureHealthResponseDto,
  })
  @ApiResponse({
    description: 'This replica has exhausted its bounded readiness request budget.',
    status: HttpStatus.TOO_MANY_REQUESTS,
  })
  async checkDependencies(): Promise<InfrastructureHealthResponseDto> {
    return resolveInfrastructureHealthResponse(this.health);
  }
}
