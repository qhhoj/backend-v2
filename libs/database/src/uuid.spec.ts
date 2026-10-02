import { UUID } from 'mongodb';
import { newId, toUuid, uuidStr } from './uuid';

describe('uuid', () => {
  it('generates time-ordered v7 ids', () => {
    const [a, b] = [newId(), newId()];
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(a < b).toBe(true);
  });
  it('round-trips through BSON UUID', () => {
    const id = newId();
    expect(toUuid(id)).toBeInstanceOf(UUID);
    expect(uuidStr(toUuid(id))).toBe(id);
    expect(uuidStr(id)).toBe(id);
  });
});
