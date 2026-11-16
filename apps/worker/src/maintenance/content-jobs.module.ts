import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ENV, EnvModule, StorageModule, workerConfig } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { workerTuning } from '../worker-tuning';
import {
  FETCH,
  ImageDownloader,
} from './rehost-hackmd-images/image-downloader';
import {
  REHOST_OPTIONS,
  RehostHackmdImagesJob,
} from './rehost-hackmd-images/rehost-hackmd-images.job';
import type { RehostOptions } from './rehost-hackmd-images/rehost-hackmd-images.job';
import { RerenderContentJob } from './rerender-content/rerender-content.job';

/** What the manual content jobs boot: data access and media storage only, no queue, processor or schedule. */
@Module({
  imports: [
    EnvModule.forRoot(workerConfig, workerTuning),
    DatabaseModule.forRoot(ENV),
    StorageModule,
  ],
  providers: [
    ImageDownloader,
    { provide: FETCH, useValue: globalThis.fetch },
    RehostHackmdImagesJob,
    RerenderContentJob,
  ],
})
export class ContentJobsModule {
  static withRehostOptions(options: RehostOptions): DynamicModule {
    return {
      module: ContentJobsModule,
      providers: [{ provide: REHOST_OPTIONS, useValue: options }],
    };
  }
}
