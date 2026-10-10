import { ApiProperty } from '@nestjs/swagger';

export class ContestExportStatusResponse {
  /** Whether the zip is not prepared, being prepared or ready. */
  @ApiProperty({ enum: ['none', 'preparing', 'ready'] })
  state!: 'none' | 'preparing' | 'ready';
  /** When the last preparation was requested, ISO 8601. */
  preparedAt!: string | null;
  /** When the zip on disk was written, ISO 8601. */
  readyAt!: string | null;
  /** Zip size in bytes; null when none exists. */
  size!: number | null;
  /** When another request is allowed; null: now. */
  nextPrepareAt!: string | null;
}
