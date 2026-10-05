import { Module } from '@nestjs/common';
import { EnvModule, QueueModule, StorageModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    StorageModule,
    QueueModule,
    ProblemFilesModule,
  ],
})
export class WorkerModule {}
