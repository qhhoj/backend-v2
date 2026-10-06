import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EFFECTS_SWEEP_QUEUE } from '@libs/judging';
import { SubmissionEffectsModule } from '../submission-effects/submission-effects.module';
import { EffectsSweepProcessor } from './effects-sweep.processor';
import { EffectsSweepService } from './effects-sweep.service';

@Module({
  imports: [
    SubmissionEffectsModule,
    BullModule.registerQueue({ name: EFFECTS_SWEEP_QUEUE }),
  ],
  providers: [EffectsSweepProcessor, EffectsSweepService],
})
export class EffectsSweepModule {}
