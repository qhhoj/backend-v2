import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';

/** Lane C fills imports, controllers and providers. */
@Module({ imports: [AuthModule], controllers: [], providers: [] })
export class SyncModule {}
