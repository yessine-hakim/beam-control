import { Module } from '@nestjs/common';
import { BeamModule } from '../beam/beam.module';
import { BeamGateway } from './beam.gateway';

@Module({
  imports: [BeamModule],
  providers: [BeamGateway],
})
export class GatewayModule {}
