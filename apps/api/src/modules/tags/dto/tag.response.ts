import type { Tag, TagGroup } from '@libs/database';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import type { TagProblemDocument } from '../tag-problems.repository';

export class TagResponse {
  id!: string;
  code!: string;
  name!: string;
  groupId!: string;

  static from(tag: Tag): TagResponse {
    return {
      id: tag._id,
      code: tag.code,
      name: tag.name,
      groupId: tag.groupId,
    };
  }
}

export class TagGroupResponse {
  id!: string;
  code!: string;
  name!: string;
  tags!: TagResponse[];

  static from(group: TagGroup, tags: Tag[]): TagGroupResponse {
    return {
      id: group._id,
      code: group.code,
      name: group.name,
      tags: tags.map((tag) => TagResponse.from(tag)),
    };
  }
}

export class TagCatalogResponse {
  groups!: TagGroupResponse[];
}

export class TagProblemListItemResponse {
  id!: string;
  code!: string;
  name!: string;
  link!: string;
  judge!: string | null;
  /** Sorted by code. */
  tags!: TagResponse[];

  static from(
    problem: TagProblemDocument,
    tags: Tag[],
  ): TagProblemListItemResponse {
    return {
      id: problem._id,
      code: problem.code,
      name: problem.name,
      link: problem.link,
      judge: problem.judge,
      tags: tags.map((tag) => TagResponse.from(tag)),
    };
  }
}

export class TagAssignmentResponse {
  tag!: TagResponse;
  assigner!: UserSummaryResponse | null;
}

export class TagProblemResponse extends TagProblemListItemResponse {
  assignments!: TagAssignmentResponse[];
}
