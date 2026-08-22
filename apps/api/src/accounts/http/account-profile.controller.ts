import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  NotFoundException,
  Patch,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  AccountProfileNotFoundError,
  AccountProfileVersionConflictError,
} from '../application/account-profile.errors';
import { AccountProfileService } from '../application/account-profile.service';
import { AccountAuthGuard } from '../auth/account-auth.guard';
import type { CurrentPrincipal as AuthenticatedPrincipal } from '../auth/current-principal';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { formatProfileEtag, parseRequiredProfileIfMatch } from '../auth/profile-etag';
import { AccountProfileBodyShapeInterceptor } from './account-profile-body-shape.interceptor';
import { AccountProfileResponseDto } from './dto/account-profile-response.dto';
import {
  UPDATE_ACCOUNT_PROFILE_OPENAPI_SCHEMA,
  UpdateAccountProfileDto,
} from './dto/update-account-profile.dto';
import { AccountProfilePrivacyInterceptor } from './account-profile-privacy.interceptor';

interface ProfileHttpResponse {
  setHeader(name: string, value: string): void;
}

@ApiTags('accounts')
@ApiSecurity('sessionCookie')
@UseGuards(AccountAuthGuard)
@UseInterceptors(AccountProfilePrivacyInterceptor, AccountProfileBodyShapeInterceptor)
@Controller('accounts')
export class AccountProfileController {
  constructor(private readonly profiles: AccountProfileService) {}

  @Get('me')
  @ApiOperation({ summary: 'Read the authenticated account profile' })
  @ApiOkResponse({
    type: AccountProfileResponseDto,
    headers: {
      ETag: {
        description: 'Strong account-bound profile version for a later If-Match request',
        schema: { type: 'string' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid verified principal' })
  @ApiNotFoundResponse({ description: 'No profile exists for the authenticated account' })
  async getSelf(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: ProfileHttpResponse,
  ): Promise<AccountProfileResponseDto> {
    try {
      const profile = await this.profiles.findSelf(principal.accountId);
      response.setHeader('ETag', formatProfileEtag(profile.accountId, profile.version));
      return new AccountProfileResponseDto(profile);
    } catch (error) {
      this.rethrowKnownError(error);
    }
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update permitted fields on the authenticated account profile' })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Strong account-bound ETag returned by the latest successful read',
  })
  @ApiBody({ schema: UPDATE_ACCOUNT_PROFILE_OPENAPI_SCHEMA })
  @ApiOkResponse({
    type: AccountProfileResponseDto,
    headers: {
      ETag: {
        description: 'Strong account-bound profile version after this update',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Profile fields are invalid or the update is empty' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid verified principal' })
  @ApiNotFoundResponse({ description: 'No profile exists for the authenticated account' })
  @ApiResponse({ status: 412, description: 'If-Match is malformed, mismatched, or stale' })
  @ApiResponse({ status: 428, description: 'If-Match is required' })
  async updateSelf(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateAccountProfileDto,
    @Res({ passthrough: true }) response: ProfileHttpResponse,
  ): Promise<AccountProfileResponseDto> {
    const expectedVersion = parseRequiredProfileIfMatch(ifMatch, principal.accountId);

    try {
      const profile = await this.profiles.updateSelf(
        principal.accountId,
        expectedVersion,
        body.toInput(),
      );
      response.setHeader('ETag', formatProfileEtag(profile.accountId, profile.version));
      return new AccountProfileResponseDto(profile);
    } catch (error) {
      this.rethrowKnownError(error);
    }
  }

  private rethrowKnownError(error: unknown): never {
    if (error instanceof AccountProfileNotFoundError) {
      throw new NotFoundException('Account profile not found');
    }
    if (error instanceof AccountProfileVersionConflictError) {
      throw new HttpException('Profile version does not match', HttpStatus.PRECONDITION_FAILED);
    }
    throw error;
  }
}
