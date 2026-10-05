/** A problem in the test data configuration; the message is shown to editors as `data.feedback`. */
export class ProblemDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProblemDataError';
  }
}
