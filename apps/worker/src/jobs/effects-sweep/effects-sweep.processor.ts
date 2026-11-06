import { Injectable } from '@nestjs/common';
import { JobProcessor } from '@libs/common';
import { judgingJobs } from '@libs/judging';
import { EffectsSweepService } from './effects-sweep.service';
import type { SweepResult } from './effects-sweep.service';

@Injectable()
export class EffectsSweepProcessor extends JobProcessor<void, SweepResult>(
  judgingJobs.effectsSweep,
) {
  constructor(private readonly sweeps: EffectsSweepService) {
    super();
  }

  run(): Promise<SweepResult> {
    return this.sweeps.sweep();
  }
}
