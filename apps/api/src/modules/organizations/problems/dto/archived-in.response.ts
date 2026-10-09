export class ArchivedInOrganizationResponse {
  slug!: string;
  name!: string;
}

export class ArchivedInResponse {
  organizations!: ArchivedInOrganizationResponse[];
}
