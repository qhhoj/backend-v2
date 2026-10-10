export class ArchivedInOrganizationResponse {
  /** Slug of the organization. */
  slug!: string;
  /** Name of the organization. */
  name!: string;
}

export class ArchivedInResponse {
  /** Organizations of the viewer that archived the problem. */
  organizations!: ArchivedInOrganizationResponse[];
}
