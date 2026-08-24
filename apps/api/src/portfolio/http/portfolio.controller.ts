import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AccountAuthGuard } from '../../accounts/auth/account-auth.guard';
import type { CurrentPrincipal as AuthenticatedPrincipal } from '../../accounts/auth/current-principal';
import { CurrentPrincipal } from '../../accounts/auth/current-principal.decorator';
import { loggingContext } from '../../infrastructure/logging';
import { PortfolioUnavailableError } from '../application/portfolio.errors';
import { PortfolioService } from '../application/portfolio.service';
import type { UnifiedPortfolio } from '../domain/unified-portfolio';
import { PortfolioPrivacyInterceptor } from './portfolio-privacy.interceptor';
import { UNIFIED_PORTFOLIO_RESPONSE_SCHEMA } from './portfolio-response.schema';

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

@ApiTags('portfolio')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(PortfolioPrivacyInterceptor)
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get()
  @ApiOperation({ summary: 'Read the authenticated account unified portfolio value' })
  @ApiOkResponse({
    description: 'Exact reporting-only USD value with source and freshness attribution',
    schema: UNIFIED_PORTFOLIO_RESPONSE_SCHEMA,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  @ApiResponse({ status: 503, description: 'Portfolio source data is unavailable' })
  async read(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<UnifiedPortfolio> {
    try {
      return await this.portfolio.readUnifiedPortfolio({
        accountId: principal.accountId,
        correlationId: loggingContext.requireCurrent().correlationId,
      });
    } catch (error) {
      if (error instanceof PortfolioUnavailableError) {
        response.setHeader('Retry-After', '1');
        throw new HttpException(
          {
            error: 'Service Unavailable',
            message: 'Portfolio unavailable',
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }
}
