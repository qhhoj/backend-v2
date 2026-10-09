export class SyncParticipantsResponse {
  /** Users now on the contestant list. */
  applied!: number;
  /** Usernames that matched no active user, as the client sent them. */
  unknown!: string[];
}
