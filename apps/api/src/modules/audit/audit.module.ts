import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { AuditController } from './audit.controller';
import { AuditFeedRepository } from './audit-feed.repository';
import { AuditFeedService } from './audit-feed.service';
import { AuditLabelsRepository } from './audit-labels.repository';

/** The global change log over the existing audit collections; it writes nothing. */
@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditFeedRepository, AuditLabelsRepository, AuditFeedService],
})
export class AuditModule {}
