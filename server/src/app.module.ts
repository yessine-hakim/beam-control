import { Module } from '@nestjs/common';
import { BeamModule } from './beam/beam.module';
import { FeedsModule } from './feeds/feeds.module';
import { HealthController } from './health.controller';

@Module({
  imports: [FeedsModule, BeamModule],
  controllers: [HealthController],
})
export class AppModule {}
