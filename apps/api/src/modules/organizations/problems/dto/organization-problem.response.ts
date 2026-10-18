import type { Problem } from '@libs/database';
import { ProblemTagResponse } from '../../problem-tags/dto/problem-tag.response';

export class OrganizationProblemResponse {
  /** Problem code. */
  code!: string;
  /** Problem name. */
  name!: string;
  /** Points the problem is worth. */
  points!: number;
  /** Whether the problem is public. */
  isPublic!: boolean;
  /** Whether the organization archived the problem. */
  isArchived!: boolean;
  /** When the problem document was last written (the "Cập nhật" column), not the link's tag or archive edits. */
  updatedAt!: Date;
  /** The organization's tags on the problem. */
  tags!: ProblemTagResponse[];
  /** Whether the viewer may edit the problem (the row's pencil to its editor). */
  canEdit!: boolean;

  static from(
    problem: Pick<
      Problem,
      'code' | 'name' | 'points' | 'isPublic' | 'updatedAt'
    >,
    link: { archived: boolean } | undefined,
    tags: ProblemTagResponse[],
    canEdit: boolean,
  ): OrganizationProblemResponse {
    return {
      code: problem.code,
      name: problem.name,
      points: problem.points,
      isPublic: problem.isPublic,
      isArchived: link?.archived ?? false,
      updatedAt: problem.updatedAt,
      tags,
      canEdit,
    };
  }
}
