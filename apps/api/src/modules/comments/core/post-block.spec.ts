import { INTERACT_MIN_PROBLEM_COUNT } from '@libs/community';
import { postBlockOf } from './post-block';

const user = (extra = {}) => ({
  isStaff: false,
  isSuperuser: false,
  problemCount: INTERACT_MIN_PROBLEM_COUNT,
  mute: false,
  ...extra,
});

describe('postBlockOf', () => {
  it('reports a signed-out viewer before anything else', () => {
    expect(postBlockOf(null, 'locked')?.reason).toBe('signed_out');
  });

  it('reports the lock before the account', () => {
    expect(postBlockOf(user({ mute: true }), 'contest')?.reason).toBe(
      'contest',
    );
    expect(postBlockOf(user({ problemCount: 0 }), 'locked')?.reason).toBe(
      'locked',
    );
  });

  it('reports a mute before missing solves', () => {
    expect(postBlockOf(user({ mute: true, problemCount: 0 }), null)).toEqual({
      reason: 'muted',
      solved: null,
      required: null,
    });
  });

  it('gives solved and required counts for a newcomer', () => {
    expect(postBlockOf(user({ problemCount: 2 }), null)).toEqual({
      reason: 'needs_solved',
      solved: 2,
      required: INTERACT_MIN_PROBLEM_COUNT,
    });
  });

  it('lets staff post whatever they solved, unless muted', () => {
    expect(
      postBlockOf(user({ isStaff: true, problemCount: 0 }), null),
    ).toBeNull();
    expect(
      postBlockOf(user({ isStaff: true, problemCount: 0, mute: true }), null)
        ?.reason,
    ).toBe('muted');
  });
});
