import { Module } from '@nestjs/common';
import { RevisionsRepository } from './revisions.repository';

/** What every API module may need without importing a feature module: the site-wide change history. Its DTO helpers (`dto/`) and `multipart` are plain imports. */
@Module({
  providers: [RevisionsRepository],
  exports: [RevisionsRepository],
})
export class SharedApiModule {}
