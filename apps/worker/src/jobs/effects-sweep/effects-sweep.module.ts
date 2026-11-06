import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { EffectsSweepProcessor } from './effects-sweep.processor';
import { EffectsSweepService } from './effects-sweep.service';

@Module({
  imports: [
    SubmissionEffectsModule,
    JobsModule.register(judgingJobs.effectsSweep, judgingJobs.graded),
  ],
  providers: [EffectsSweepProcessor, EffectsSweepService],
})
export class EffectsSweepModule {}
