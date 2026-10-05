/** Why an import stopped; stored as the job's failure reason and shown to the requester. */
export class PolygonImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolygonImportError';
  }
}
