import { Module } from '@nestjs/common';
import { FeedsModule } from './feeds/feeds.module';
import { HealthController } from './health.controller';

@Module({
  imports: [FeedsModule],
  controllers: [HealthController],
})
export class AppModule {}
