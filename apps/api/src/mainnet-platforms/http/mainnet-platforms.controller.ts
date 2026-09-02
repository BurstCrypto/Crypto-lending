import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AccountAuthGuard } from '../../accounts/auth/account-auth.guard';
import { MainnetPlatformDirectoryService } from '../application/mainnet-platform-directory.service';
import type { MainnetPlatformDirectory } from '../domain/mainnet-platform-directory';
import { MainnetPlatformsPrivacyInterceptor } from './mainnet-platforms-privacy.interceptor';
import { MAINNET_PLATFORM_DIRECTORY_RESPONSE_SCHEMA } from './mainnet-platforms-response.schema';

@ApiTags('mainnet-platforms')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(MainnetPlatformsPrivacyInterceptor)
@Controller('mainnet-platforms')
export class MainnetPlatformsController {
  constructor(private readonly directory: MainnetPlatformDirectoryService) {}

  @Get()
  @ApiOperation({ summary: 'List planned mainnet lending platform integrations' })
  @ApiOkResponse({
    description: 'Non-executable platform roadmap with explicit integration availability',
    schema: MAINNET_PLATFORM_DIRECTORY_RESPONSE_SCHEMA,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authenticated session' })
  read(): MainnetPlatformDirectory {
    return this.directory.read();
  }
}
