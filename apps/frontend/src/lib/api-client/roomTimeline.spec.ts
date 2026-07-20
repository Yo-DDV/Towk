import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { create } from '@bufbuild/protobuf';
import { MessageSchema } from '@towk/api-types/api/v1/message_types_pb';
import { describe, expect, it } from 'vitest';
import { messagePostedPayload } from './roomTimeline';

describe('messagePostedPayload', () => {
  it('maps deleted_at to the exact ISO timestamp', () => {
    const deletedAt = timestampFromDate(new Date('2026-07-10T10:11:12.345Z'));

    expect(messagePostedPayload(create(MessageSchema, { deletedAt }), {}).deletedAt).toBe(
      '2026-07-10T10:11:12.345Z'
    );
  });

  it('keeps deletedAt null when the server omits the metadata', () => {
    expect(messagePostedPayload(create(MessageSchema), {}).deletedAt).toBeNull();
  });
});
