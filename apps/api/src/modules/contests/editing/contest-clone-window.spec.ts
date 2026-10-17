import { shiftedWindow } from './contest-clone-window';

const at = (iso: string) => new Date(iso);

describe('shiftedWindow', () => {
  it('moves the end and the registration window by the same amount as the start', () => {
    const window = shiftedWindow(
      {
        startTime: at('2026-10-16T03:40:00Z'),
        endTime: at('2026-10-16T07:40:00Z'),
        registrationStart: at('2026-10-10T00:00:00Z'),
        registrationEnd: at('2026-10-16T03:00:00Z'),
      },
      at('2026-10-23T05:00:00Z'),
    );
    expect(window).toEqual({
      startTime: at('2026-10-23T05:00:00Z'),
      endTime: at('2026-10-23T09:00:00Z'),
      registrationStart: at('2026-10-17T01:20:00Z'),
      registrationEnd: at('2026-10-23T04:20:00Z'),
    });
  });

  it('keeps an open registration open and can move a contest earlier', () => {
    const window = shiftedWindow(
      {
        startTime: at('2026-10-16T03:40:00Z'),
        endTime: at('2026-10-20T03:40:00Z'),
        registrationStart: null,
        registrationEnd: null,
      },
      at('2026-10-01T03:40:00Z'),
    );
    expect(window.endTime).toEqual(at('2026-10-05T03:40:00Z'));
    expect(window.registrationStart).toBeNull();
    expect(window.registrationEnd).toBeNull();
  });
});
