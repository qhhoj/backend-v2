/** The statement is too large or too deeply nested to render safely. */
export class RenderLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderLimitError';
  }
}
