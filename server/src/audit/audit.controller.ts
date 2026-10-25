import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Read-only audit trail: the regulator's view of every intervention. */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    const n = Number.parseInt(limit ?? '', 10);
    return this.audit.newest(Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : 100);
  }
}
