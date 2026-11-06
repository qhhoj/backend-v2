import { isDuplicateKey, retryOnDuplicateKey } from './duplicate-key';

const duplicate = (extra: object = {}) => ({ code: 11000, ...extra });

describe('isDuplicateKey', () => {
  it('reads a single write, optionally by field', () => {
    expect(isDuplicateKey(duplicate())).toBe(true);
    expect(isDuplicateKey(duplicate({ keyPattern: { name: 1 } }), 'name')).toBe(
      true,
    );
    expect(isDuplicateKey(duplicate({ keyPattern: { name: 1 } }), 'slug')).toBe(
      false,
    );
    expect(isDuplicateKey(duplicate(), 'name')).toBe(false);
    expect(isDuplicateKey({ code: 121 })).toBe(false);
  });

  it('finds a duplicate among bulk write errors, as an array or one object', () => {
    expect(
      isDuplicateKey({ writeErrors: [{ code: 5 }, { code: 11000 }] }),
    ).toBe(true);
    expect(isDuplicateKey({ writeErrors: { code: 11000 } })).toBe(true);
    expect(isDuplicateKey({ writeErrors: [{ code: 5 }] })).toBe(false);
  });
});

describe('retryOnDuplicateKey', () => {
  const failing = (times: number, error: unknown = duplicate()) => {
    let calls = 0;
    return {
      write: () => {
        calls += 1;
        return calls <= times
          ? Promise.reject(error as Error)
          : Promise.resolve(calls);
      },
      calls: () => calls,
    };
  };

  it('returns the first success', async () => {
    const run = failing(2);
    await expect(retryOnDuplicateKey(run.write, 3)).resolves.toBe(3);
  });

  it('throws the last duplicate error after the attempts are spent', async () => {
    const run = failing(5);
    await expect(retryOnDuplicateKey(run.write, 3)).rejects.toEqual(
      duplicate(),
    );
    expect(run.calls()).toBe(3);
  });

  it('does not retry another error, nor a duplicate on another field', async () => {
    const other = failing(1, new Error('boom'));
    await expect(retryOnDuplicateKey(other.write, 3)).rejects.toThrow('boom');
    expect(other.calls()).toBe(1);
    const wrongField = failing(1, duplicate({ keyPattern: { a: 1 } }));
    await expect(retryOnDuplicateKey(wrongField.write, 3, 'b')).rejects.toEqual(
      duplicate({ keyPattern: { a: 1 } }),
    );
    expect(wrongField.calls()).toBe(1);
  });
});
