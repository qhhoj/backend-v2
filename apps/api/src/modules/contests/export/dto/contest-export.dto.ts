import { ApiProperty } from '@nestjs/swagger';

export class ContestExportStatusResponse {
  @ApiProperty({ enum: ['none', 'preparing', 'ready'] })
  state!: 'none' | 'preparing' | 'ready';
  preparedAt!: string | null;
  readyAt!: string | null;
  size!: number | null;
  /** When another request is allowed; null: now. */
  nextPrepareAt!: string | null;
}
