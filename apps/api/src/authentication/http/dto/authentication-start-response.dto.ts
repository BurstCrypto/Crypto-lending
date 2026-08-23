import { ApiProperty } from '@nestjs/swagger';

export class AuthenticationStartResponseDto {
  @ApiProperty({
    description:
      'Managed identity-provider authorization URL for an immediate top-level navigation',
    example: 'https://identity.example/authorize?client_id=crypto-lending',
    format: 'uri',
  })
  readonly authorizationUrl: string;

  constructor(authorizationUrl: string) {
    this.authorizationUrl = authorizationUrl;
    Object.freeze(this);
  }
}
