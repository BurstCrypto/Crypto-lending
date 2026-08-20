import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { InfrastructureHealthResponseDto } from './infrastructure-health-response.dto';
import { resolveInfrastructureHealthResponse } from './infrastructure-health.controller';
import { InfrastructureHealthService } from './infrastructure-health.service';

/**
 * Load-balancer readiness target. The public ALB listener rejects this prefix;
 * only target-group probes on the private task network can reach it.
 */
@ApiExcludeController()
@Controller('internal/health')
export class InternalInfrastructureHealthController {
  constructor(private readonly health: InfrastructureHealthService) {}

  @Get('dependencies')
  @Header('Cache-Control', 'no-store')
  checkDependencies(): Promise<InfrastructureHealthResponseDto> {
    return resolveInfrastructureHealthResponse(this.health);
  }
}
