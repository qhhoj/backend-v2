import { signPolygonParams } from './polygon-signature';

// Expected digests were computed independently with Python's hashlib over the documented string.
describe('signPolygonParams', () => {
  it('signs the documented string: salt, method, parameters sorted by name with apiKey and time, secret', () => {
    const signed = signPolygonParams(
      'problem.saveTest',
      { testset: 'tests', testIndex: '1', problemId: '42' },
      { apiKey: 'KEY', apiSecret: 'SECRET' },
      { rand: 'abcdef', time: 1_700_000_000 },
    );
    expect(signed).toEqual({
      problemId: '42',
      testIndex: '1',
      testset: 'tests',
      apiKey: 'KEY',
      time: '1700000000',
      apiSig:
        'abcdef3bb7d63d08447227fe3fa459af4d42f17e3c503306405a166a99c4db7f18cb2d12e05513b696af7485c66f9e202a63efbe627d24075916aabc1328654d0e48d7',
    });
  });

  it('does not depend on the order the parameters were given in', () => {
    const credentials = { apiKey: 'K', apiSecret: 'S' };
    const salt = { rand: '000123', time: 5 };
    const forward = signPolygonParams(
      'problems.list',
      { a: '2', b: '1' },
      credentials,
      salt,
    );
    const backward = signPolygonParams(
      'problems.list',
      { b: '1', a: '2' },
      credentials,
      salt,
    );
    expect(forward.apiSig).toBe(backward.apiSig);
    expect(forward.apiSig).toBe(
      '000123f4a6eb40dd209ac7927132a3f6642510353b5b6bd61b5a3833ec0429a731b0f0a33b911fe02681bdb08e6c9157426c18d6377d322ca29c17acaa86c0d5f620de',
    );
  });
});
