import { Module } from '@nestjs/common';
import { FeedsService } from './feeds.service';

@Module({
  providers: [FeedsService],
  exports: [FeedsService],
})
export class FeedsModule {}
