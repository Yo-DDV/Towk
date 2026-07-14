import { describe, expect, it } from 'vitest';
import { callJoinActionFromURL } from './callJoinAction';

describe('callJoinActionFromURL', () => {
  it('returns null when a notification only opens the room', () => {
    expect(callJoinActionFromURL(new URL('https://towk.example/chat/-/R1'))).toBeNull();
  });

  it('consumes a valid call identity and preserves unrelated URL state', () => {
    expect(
      callJoinActionFromURL(
        new URL('https://towk.example/chat/-/R1?joinCall=C-current&highlight=E1#message')
      )
    ).toEqual({
      expectedCallId: 'C-current',
      nextUrl: '/chat/-/R1?highlight=E1#message'
    });
  });

  it.each(['', 'C bad', 'C/'.repeat(65)])('strips invalid identities without joining: %j', (id) => {
    const url = new URL('https://towk.example/chat/-/R1');
    url.searchParams.set('joinCall', id);
    expect(callJoinActionFromURL(url)).toEqual({
      expectedCallId: null,
      nextUrl: '/chat/-/R1'
    });
  });
});
