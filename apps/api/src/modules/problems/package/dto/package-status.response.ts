import { ApiProperty } from '@nestjs/swagger';

/** Body (inside `data`) of `POST /problems/:code/package` (200 `ready`, 202 `building`). */
export class PackageStatusResponse {
  /** `ready`: the package is cached; `building`: a build is queued or running. */
  @ApiProperty({ enum: ['ready', 'building'] }) status!: 'ready' | 'building';
  /** `<dataVersion>.<contentHash>` of what the build is (or was) for. */
  key!: string;
}

/** Body (inside `data`) of the 202 of `GET /problems/:code/package` while the build runs. */
export class PackageBuildingResponse {
  /** Always `building`. */
  @ApiProperty({ enum: ['building'] }) status!: 'building';
}
