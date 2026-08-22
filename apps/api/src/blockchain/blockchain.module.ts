import { Module } from '@nestjs/common';

import { SupportedAssetNormalizationService } from './application/supported-asset-normalization.service';

@Module({
  providers: [SupportedAssetNormalizationService],
  exports: [SupportedAssetNormalizationService],
})
export class BlockchainModule {}
