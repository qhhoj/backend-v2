import { UUID } from 'mongodb';
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
  it('recognises uuids of any version and nothing else', () => {
    expect(isUuid(newId())).toBe(true);
    expect(isUuid('6F9619FF-8B86-D011-B42D-00C04FC964FF')).toBe(true);
    for (const value of ['', 'abc', `${newId()}x`, newId().replace(/-/g, '')])
      expect(isUuid(value)).toBe(false);
  });
});
