/** What one rated contest did to a participant's rating. */
export class RatingChangeResponse {
  /** The rating after this contest. */
  rating!: number;
  /** The rating after this contest minus the one before it; null on the user's first rated contest. */
  delta!: number | null;
}
