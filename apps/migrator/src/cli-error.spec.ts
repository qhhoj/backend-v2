import { failCommand } from './cli-error';

describe('failCommand', () => {
  afterEach(() => (process.exitCode = undefined));

  it('marks the process failed and prints the stack', () => {
    const written: string[] = [];
    const error = new Error('connect ECONNREFUSED');
    failCommand(error, { write: (text: string) => written.push(text) > 0 });
    expect(process.exitCode).toBe(1);
    expect(written.join('')).toContain(error.stack);
  });
});
