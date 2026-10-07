import { Logger } from '@nestjs/common';
import { ProblemEvents } from './problem.events';

describe('ProblemEvents', () => {
  it('calls every listener even when one throws, and logs the failure', () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const events = new ProblemEvents();
    const second = jest.fn();
    events.on('statementChanged', () => {
      throw new Error('boom');
    });
    events.on('statementChanged', second);
    expect(() => events.emit('statementChanged', 'id')).not.toThrow();
    expect(second).toHaveBeenCalledWith('id');
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
