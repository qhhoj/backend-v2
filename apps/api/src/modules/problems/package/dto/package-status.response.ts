import { ApiProperty } from '@nestjs/swagger';

/** Body (inside `data`) of `POST /problems/:code/package` (200 `ready`, 202 `building`). */
export class PackageStatusResponse {
  @ApiProperty({ enum: ['ready', 'building'] }) status!: 'ready' | 'building';
  /** `<dataVersion>.<contentHash>` of what the build is (or was) for. */
  key!: string;
}

/** Body (inside `data`) of the 202 of `GET /problems/:code/package` while the build runs. */
export class PackageBuildingResponse {
  @ApiProperty({ enum: ['building'] }) status!: 'building';
}
