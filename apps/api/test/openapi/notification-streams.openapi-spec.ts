import type { OpenAPIObject } from '@nestjs/swagger';
import { newId } from '@libs/database';
import { notificationFrameData } from '../../src/modules/notifications/streams/user-streams.service';
import { loadDocument } from './document';
import { looseSites } from './schema-scans';
import { frameDataKeys, streamEventNames } from './stream-frames';

const USER_STREAM = '/api/internal/events/user';

describe('user event stream schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('documents the user stream with its notification frame and the resync frame', () => {
    expect(streamEventNames(document, USER_STREAM)).toEqual([
      'notification',
      'resync',
    ]);
  });

  it('documents exactly the members the emitter sends, and not the owner of the row', () => {
    const sent = notificationFrameData({ userId: newId(), id: newId() });
    expect(frameDataKeys(document, 'NotificationFrame')).toEqual(
      Object.keys(sent).sort(),
    );
    expect(frameDataKeys(document, 'NotificationFrame')).toEqual(['id']);
  });

  it('has no untyped parameter, empty schema or bare object on the user stream', () => {
    expect(
      looseSites(document).filter(
        (site) =>
          site.includes(USER_STREAM) || site.includes('/schemas/Notification'),
      ),
    ).toEqual([]);
  });
});
