import { Module } from '@nestjs/common';
import { FeedsModule } from '../feeds/feeds.module';
import { BeamController } from './beam.controller';
import { BeamService } from './beam.service';

@Module({
  imports: [FeedsModule],
  controllers: [BeamController],
  providers: [BeamService],
  exports: [BeamService],
})
export class BeamModule {}
