import type { Tag, TagGroup } from '@libs/database';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import type { TagProblemDocument } from '../tag-problems.repository';

export class TagResponse {
  /** Tag id. */
  id!: string;
  /** Unique tag code. */
  code!: string;
  /** Tag name. */
  name!: string;
  /** Id of the tag group. */
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
  /** Group id. */
  id!: string;
  /** Unique group code. */
  code!: string;
  /** Group name. */
  name!: string;
  /** Tags of the group, sorted by code. */
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
  /** Tag groups, sorted by code. */
  groups!: TagGroupResponse[];
}

export class TagProblemListItemResponse {
  /** Entry id. */
  id!: string;
  /** Problem code on its judge, with the judge prefix. */
  code!: string;
  /** Problem title. */
  name!: string;
  /** URL of the problem. */
  link!: string;
  /** Judge the problem belongs to; null when unknown. */
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
  /** The tag. */
  tag!: TagResponse;
  /** User who assigned it; null if the account no longer exists. */
  assigner!: UserSummaryResponse | null;
}

export class TagProblemResponse extends TagProblemListItemResponse {
  /** Each tag with the user who assigned it. */
  assignments!: TagAssignmentResponse[];
}
