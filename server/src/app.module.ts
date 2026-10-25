import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { BeamModule } from './beam/beam.module';
import { FeedsModule } from './feeds/feeds.module';
import { HealthController } from './health.controller';

@Module({
  imports: [FeedsModule, BeamModule, AuditModule],
  controllers: [HealthController],
})
export class AppModule {}
