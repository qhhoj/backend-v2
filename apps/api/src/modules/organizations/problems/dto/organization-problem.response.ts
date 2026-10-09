import type { Problem } from '@libs/database';
import { ProblemTagResponse } from '../../problem-tags/dto/problem-tag.response';

export class OrganizationProblemResponse {
  code!: string;
  name!: string;
  points!: number;
  isPublic!: boolean;
  isArchived!: boolean;
  /** When the problem document was last written (the "Cập nhật" column), not the link's tag or archive edits. */
  updatedAt!: Date;
  tags!: ProblemTagResponse[];

  static from(
    problem: Pick<
      Problem,
      'code' | 'name' | 'points' | 'isPublic' | 'updatedAt'
    >,
    link: { archived: boolean } | undefined,
    tags: ProblemTagResponse[],
  ): OrganizationProblemResponse {
    return {
      code: problem.code,
      name: problem.name,
      points: problem.points,
      isPublic: problem.isPublic,
      isArchived: link?.archived ?? false,
      updatedAt: problem.updatedAt,
      tags,
    };
  }
}
