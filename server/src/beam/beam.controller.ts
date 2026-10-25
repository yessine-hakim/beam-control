import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { BeamService } from './beam.service';

@Controller('state')
export class BeamController {
  constructor(private readonly beam: BeamService) {}

  /** Latest snapshot, for a screen's first paint before the socket delivers one. */
  @Get()
  state() {
    const snapshot = this.beam.latest();
    if (!snapshot) throw new ServiceUnavailableException('Beam Control is starting');
    return snapshot;
  }
}
