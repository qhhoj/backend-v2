import { checkDataRoots } from './data-roots';

describe('checkDataRoots', () => {
  it('names each data root inside the served media root', () =>
    expect(
      checkDataRoots({
        mediaRoot: '/srv/media',
        contestDataRoot: '/srv/media/contest',
        userDataRoot: '/srv/media/users',
      }),
    ).toEqual([
      'CONTEST_DATA_ROOT must not be inside MEDIA_ROOT',
      'USER_DATA_ROOT must not be inside MEDIA_ROOT',
    ]));
  it('refuses nested contest and user data roots either way round', () => {
    const nested =
      'USER_DATA_ROOT and CONTEST_DATA_ROOT must be separate directories';
    expect(
      checkDataRoots({
        mediaRoot: '/srv/media',
        contestDataRoot: '/srv/data',
        userDataRoot: '/srv/data/users',
      }),
    ).toEqual([nested]);
    expect(
      checkDataRoots({
        mediaRoot: '/srv/media',
        contestDataRoot: '/srv/data/contest',
        userDataRoot: '/srv/data',
      }),
    ).toEqual([nested]);
  });
  it('accepts separate roots and unset ones', () => {
    expect(
      checkDataRoots({
        mediaRoot: '/srv/media',
        contestDataRoot: '/srv/contest',
        userDataRoot: '/srv/users',
      }),
    ).toEqual([]);
    expect(
      checkDataRoots({
        mediaRoot: '/srv/media',
        contestDataRoot: null,
        userDataRoot: null,
      }),
    ).toEqual([]);
  });
});
