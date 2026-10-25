import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import path from 'node:path';
import type { Subscription } from 'rxjs';
import { BeamService } from '../beam/beam.service';
import type { LogEntry } from '../core/types';
import { appendEntry, readNewest } from './audit';

export const AUDIT_FILE = path.resolve(__dirname, '../../data/audit.jsonl');

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Audit');
  private subscription: Subscription | null = null;
  // Appends run one after another so lines never interleave.
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly beam: BeamService) {}

  onModuleInit() {
    this.subscription = this.beam.log$.subscribe((entry) => {
      this.queue = this.queue
        .then(() => appendEntry(AUDIT_FILE, entry))
        .catch((error) => this.logger.error(`Audit append failed: ${error}`));
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  newest(limit: number): Promise<LogEntry[]> {
    return readNewest(AUDIT_FILE, limit);
  }
}
