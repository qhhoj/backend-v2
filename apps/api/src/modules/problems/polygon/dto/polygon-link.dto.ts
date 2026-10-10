import { IsBoolean } from 'class-validator';

export class UpdatePolygonLinkDto {
  @IsBoolean() autoSync!: boolean;
}
