import { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';

export class PostComposeOptionsResponse {
  /** The viewer may write a personal post: not muted, and enough solved problems (superusers need none). */
  canWritePersonal!: boolean;
  /** Solved problems a personal post needs. */
  minSolvedProblems!: number;
  /** Organizations the viewer may post for: an admin of each, unmuted, with judge.edit_organization_post. */
  organizations!: OrganizationSummaryResponse[];
}
