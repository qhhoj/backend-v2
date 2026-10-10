export class PolygonStatusResponse {
  /** Both `polygon.apiKey` and `polygon.apiSecret` are set. */
  connected!: boolean;
  /** `polygon.accountName`: the login setters add as a READ co-author; empty when unset. */
  accountName!: string;
}

export class PolygonTestResponse {
  ok!: boolean;
  /** Problems the account can read. */
  problemCount!: number;
}
