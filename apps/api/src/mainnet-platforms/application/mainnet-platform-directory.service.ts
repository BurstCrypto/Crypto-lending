import { Injectable } from '@nestjs/common';

import {
  MAINNET_PLATFORM_DIRECTORY,
  type MainnetPlatformDirectory,
} from '../domain/mainnet-platform-directory';

@Injectable()
export class MainnetPlatformDirectoryService {
  read(): MainnetPlatformDirectory {
    return MAINNET_PLATFORM_DIRECTORY;
  }
}
