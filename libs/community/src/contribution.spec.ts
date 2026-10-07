import { contributionPoints } from './contribution';

describe('contribution points', () => {
  it('weighs votes by 1, good tickets by 10 and public suggestions by 20', () => {
    expect(
      contributionPoints({
        commentScore: 3,
        postScore: 2,
        goodTickets: 1,
        publicSuggestions: 2,
      }),
    ).toBe(55);
    expect(
      contributionPoints({
        commentScore: -7,
        postScore: 1,
        goodTickets: 0,
        publicSuggestions: 0,
      }),
    ).toBe(-6);
  });
});
