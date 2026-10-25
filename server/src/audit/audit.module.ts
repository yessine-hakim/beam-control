import { Module } from '@nestjs/common';
import { BeamModule } from '../beam/beam.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [BeamModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
