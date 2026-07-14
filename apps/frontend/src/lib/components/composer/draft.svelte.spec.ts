import { afterEach, describe, expect, it } from 'vitest';
import { purgeOfflineAccount, type PrivateDataScope } from '$lib/pwa/offlineData';
import { DraftState, draftKey } from './draft.svelte';

const scope: PrivateDataScope = {
  serverId: 'draft-state-server',
  serverUrl: 'https://draft-state.example.test',
  userId: 'U-draft-state'
};

afterEach(async () => {
  await purgeOfflineAccount(scope).catch(() => undefined);
  sessionStorage.clear();
});

describe('encrypted composer draft state', () => {
  it('restores text and staged files after a new state instance starts', async () => {
    const key = draftKey('R1');
    const first = new DraftState();
    first.switchKey(key, scope, 'R1');
    first.persistText('restart-safe draft', true);
    first.persistFiles([
      {
        file: new File(['restart-safe file'], 'draft.txt', { type: 'text/plain' }),
        url: 'blob:first'
      }
    ]);
    await Promise.all([first.flush(), first.flushFiles()]);

    const reopened = new DraftState();
    const legacy = reopened.switchKey(key, scope, 'R1');
    const [draft, files] = await Promise.all([reopened.load(legacy), reopened.loadFiles()]);

    expect(draft).toEqual({ text: 'restart-safe draft', richMode: true });
    expect(files[0]?.file.name).toBe('draft.txt');
    await expect(files[0]?.file.text()).resolves.toBe('restart-safe file');
    for (const { url } of files) URL.revokeObjectURL(url);
  });
});
