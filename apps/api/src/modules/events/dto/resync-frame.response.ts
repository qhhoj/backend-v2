import { ApiProperty } from '@nestjs/swagger';
import { OPAQUE_JSON_OBJECT } from '@libs/common';

/** Sent after a lost subscription: reload the stored state. */
export class ResyncFrame {
  /** Always `resync`. */
  @ApiProperty({ enum: ['resync'] }) event!: 'resync';
  /** Always `{}`. */
  @ApiProperty({ ...OPAQUE_JSON_OBJECT }) data!: Record<string, never>;
}
