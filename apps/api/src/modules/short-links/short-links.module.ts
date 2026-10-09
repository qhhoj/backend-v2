import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';

/** Lane B fills controllers and providers. */
@Module({ imports: [AuthModule], controllers: [], providers: [] })
export class ShortLinksModule {}
