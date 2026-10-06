import { UUID } from 'mongodb';
import mongoose from 'mongoose';
import { isUuid, newId, toUuid, uuidStr } from './uuid';

describe('uuid', () => {
  it('generates time-ordered v7 ids', () => {
    const [first, second] = [newId(), newId()];
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first < second).toBe(true);
  });
  it('round-trips through BSON UUID', () => {
    const id = newId();
    expect(toUuid(id)).toBeInstanceOf(UUID);
    expect(uuidStr(toUuid(id))).toBe(id);
    expect(uuidStr(id)).toBe(id);
  });
  it('stringifies mongoose buffer array elements', () => {
    const id = newId();
    const mongooseBuffer = Object.assign(Buffer.from(toUuid(id).buffer), {
      toUUID: () => toUuid(id),
    });
    expect(uuidStr(mongooseBuffer)).toBe(id);
  });
  describe('isUuid', () => {
    const Probe = mongoose.model(
      'UuidProbe',
      new mongoose.Schema({ _id: mongoose.Schema.Types.UUID }),
    );
    const mongooseCasts = (value: string) => {
      try {
        Probe.findById(value).cast(Probe);
        return true;
      } catch {
        return false;
      }
    };
    // Mongoose's own matcher is unanchored, so it also casts `<uuid>x`; isUuid must not.
    it.each([
      [newId(), true],
      ['6F9619FF-8B86-4011-B42D-00C04FC964FF', true],
      ['6f9619ff-8b86-4011-b42d-00c04fc964ff', true],
      ['6F9619FF-8B86-D011-B42D-00C04FC964FF', false],
      ['00000000-0000-0000-0000-000000000000', false],
      ['ffffffff-ffff-ffff-ffff-ffffffffffff', false],
      ['', false],
      ['abc', false],
      [`${newId()}x`, false],
      [newId().replace(/-/g, ''), false],
    ])('isUuid(%s) is %s', (value, expected) => {
      expect(isUuid(value)).toBe(expected);
      if (expected) expect(mongooseCasts(value)).toBe(true);
    });
    it('rejects ids Mongoose cannot cast', () => {
      for (const value of [
        '6F9619FF-8B86-D011-B42D-00C04FC964FF',
        '00000000-0000-0000-0000-000000000000',
      ])
        expect([isUuid(value), mongooseCasts(value)]).toEqual([false, false]);
    });
  });
});
