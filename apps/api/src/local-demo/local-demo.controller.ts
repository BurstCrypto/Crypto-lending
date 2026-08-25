import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AccountAuthGuard } from '../accounts/auth/account-auth.guard';
import type { CurrentPrincipal as AuthenticatedPrincipal } from '../accounts/auth/current-principal';
import { CurrentPrincipal } from '../accounts/auth/current-principal.decorator';
import { loggingContext } from '../infrastructure/logging';
import { currentJobCorrelationContext } from '../infrastructure/outbox/job-envelope';
import {
  LOCAL_DEMO_ALLOCATION_PREVIEW_BODY_SCHEMA,
  LOCAL_DEMO_ALLOCATION_PREVIEW_RESPONSE_SCHEMA,
  LOCAL_DEMO_CONNECT_BODY_SCHEMA,
  LOCAL_DEMO_DISCONNECT_BODY_SCHEMA,
  LOCAL_DEMO_WALLET_CONNECTION_SCHEMA,
  LocalDemoBodyError,
  LocalDemoPrivacyInterceptor,
  parseLocalDemoAllocationPreviewBody,
  parseLocalDemoConnectBody,
  parseLocalDemoDisconnectBody,
} from './local-demo-http';
import {
  LocalDemoAllocationService,
  type LocalDemoAllocationPreviewResponse,
} from './local-demo-allocation.service';
import { LocalDemoPortfolioService } from './local-demo-portfolio.service';
import {
  LOCAL_DEMO_RUNTIME_CONFIG,
  type LocalDemoRuntimeConfig,
} from './local-demo-runtime.config';
import {
  type LocalDemoWalletConnection,
  LocalDemoWalletService,
} from './local-demo-wallet.service';

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

function badBody(error: unknown): never {
  if (error instanceof LocalDemoBodyError) {
    throw new BadRequestException('Local demo request is invalid');
  }
  throw error;
}

function unavailable(response: HeaderWriter): never {
  response.setHeader('Retry-After', '1');
  throw new HttpException(
    {
      error: 'Service Unavailable',
      message: 'Local demo data is unavailable',
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

@ApiTags('local-demo')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(LocalDemoPrivacyInterceptor)
@Controller('local-demo')
export class LocalDemoController {
  constructor(
    private readonly wallets: LocalDemoWalletService,
    private readonly portfolio: LocalDemoPortfolioService,
    private readonly allocations: LocalDemoAllocationService,
    @Inject(LOCAL_DEMO_RUNTIME_CONFIG) private readonly config: LocalDemoRuntimeConfig,
  ) {}

  @Get('wallets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List synthetic wallets proven for the authenticated demo account' })
  @ApiOkResponse({
    description: 'Account-scoped synthetic wallet projections',
    schema: { type: 'array', maxItems: 2, items: LOCAL_DEMO_WALLET_CONNECTION_SCHEMA },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  @ApiNotFoundResponse({ description: 'Synthetic local demo runtime is disabled' })
  listWallets(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): readonly LocalDemoWalletConnection[] {
    this.assertEnabled();
    try {
      return this.wallets.list(principal.accountId);
    } catch {
      return unavailable(response);
    }
  }

  @Post('wallets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and prove one allowlisted synthetic demo wallet' })
  @ApiBody({ schema: LOCAL_DEMO_CONNECT_BODY_SCHEMA })
  @ApiCreatedResponse({
    description: 'The server-completed proof produced an account-scoped wallet projection',
    schema: LOCAL_DEMO_WALLET_CONNECTION_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Body is malformed or contains wallet material' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  @ApiNotFoundResponse({ description: 'Synthetic local demo runtime is disabled' })
  @ApiResponse({ status: 503, description: 'Synthetic proof or persistence is unavailable' })
  async connectWallet(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<LocalDemoWalletConnection> {
    this.assertEnabled();
    let namespace: ReturnType<typeof parseLocalDemoConnectBody>['namespace'];
    try {
      namespace = parseLocalDemoConnectBody(body).namespace;
    } catch (error) {
      return badBody(error);
    }
    try {
      return await this.wallets.connect({
        accountId: principal.accountId,
        namespace,
        correlationId: loggingContext.requireCurrent().correlationId,
      });
    } catch {
      return unavailable(response);
    }
  }

  @Delete('wallets')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect one synthetic wallet from the authenticated demo account' })
  @ApiBody({ schema: LOCAL_DEMO_DISCONNECT_BODY_SCHEMA })
  @ApiNoContentResponse({ description: 'The account-scoped connection is no longer active' })
  @ApiBadRequestResponse({ description: 'Body is malformed' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  @ApiNotFoundResponse({ description: 'Synthetic local demo runtime is disabled' })
  disconnectWallet(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): void {
    this.assertEnabled();
    let connectionId: string;
    try {
      connectionId = parseLocalDemoDisconnectBody(body).connectionId;
    } catch (error) {
      return badBody(error);
    }
    try {
      this.wallets.disconnect(principal.accountId, connectionId);
    } catch {
      return unavailable(response);
    }
  }

  @Get('portfolio')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read the authenticated synthetic demo portfolio and buying power' })
  @ApiOkResponse({
    description: 'Closed KAN-69 presentation payload composed through KAN-63 through KAN-68',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  @ApiNotFoundResponse({ description: 'Synthetic local demo runtime is disabled' })
  @ApiResponse({ status: 503, description: 'A complete synthetic snapshot is unavailable' })
  async readPortfolio(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<unknown> {
    this.assertEnabled();
    try {
      const correlation = currentJobCorrelationContext();
      if (correlation === undefined) throw new Error('Missing local demo correlation context');
      return await this.portfolio.read(principal.accountId, correlation);
    } catch {
      return unavailable(response);
    }
  }

  @Post('allocation-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview one synthetic allocation without authorizing an action' })
  @ApiBody({ schema: LOCAL_DEMO_ALLOCATION_PREVIEW_BODY_SCHEMA })
  @ApiOkResponse({
    description: 'Exact-cent, non-authorizing allocation and fee estimate',
    schema: LOCAL_DEMO_ALLOCATION_PREVIEW_RESPONSE_SCHEMA,
  })
  @ApiBadRequestResponse({ description: 'Body is malformed or contains unsupported fields' })
  @ApiUnauthorizedResponse({ description: 'Missing session, origin, or CSRF proof' })
  @ApiNotFoundResponse({ description: 'Synthetic local demo runtime is disabled' })
  @ApiResponse({ status: 503, description: 'A complete synthetic snapshot is unavailable' })
  async previewAllocation(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderWriter,
  ): Promise<LocalDemoAllocationPreviewResponse> {
    this.assertEnabled();
    let presetId: ReturnType<typeof parseLocalDemoAllocationPreviewBody>['presetId'];
    try {
      presetId = parseLocalDemoAllocationPreviewBody(body).presetId;
    } catch (error) {
      return badBody(error);
    }
    try {
      const correlation = currentJobCorrelationContext();
      if (correlation === undefined) throw new Error('Missing local demo correlation context');
      return await this.allocations.preview(principal.accountId, correlation, presetId);
    } catch {
      return unavailable(response);
    }
  }

  private assertEnabled(): void {
    if (this.config.mode !== 'enabled') {
      throw new NotFoundException('Not found');
    }
  }
}
