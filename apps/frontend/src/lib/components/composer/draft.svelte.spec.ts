import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activateOfflineAccount,
  purgeOfflineAccount,
  type PrivateDataScope
} from '$lib/pwa/offlineData';
import { DraftState, draftKey } from './draft.svelte';

const scope: PrivateDataScope = {
  serverId: 'draft-state-server',
  serverUrl: 'https://draft-state.example.test',
  userId: 'U-draft-state'
};

beforeEach(async () => {
  await activateOfflineAccount(scope);
});

afterEach(async () => {
  await purgeOfflineAccount(scope).catch(() => undefined);
  sessionStorage.clear();
});

describe('encrypted composer draft state', () => {
  it('keeps in-memory files available across repeated same-room loads', async () => {
    const key = draftKey('R-repeat');
    const state = new DraftState();
    const file = new File(['repeat-safe file'], 'repeat.txt', { type: 'text/plain' });
    state.switchKey(key, null, 'R-repeat');
    state.stashFiles([{ file, url: 'blob:staged' }]);

    const firstLoad = await state.loadFiles();
    const secondLoad = await state.loadFiles();

    expect(firstLoad[0]?.file).toBe(file);
    expect(secondLoad[0]?.file).toBe(file);
    expect(secondLoad[0]?.url).not.toBe(firstLoad[0]?.url);
    for (const { url } of [...firstLoad, ...secondLoad]) URL.revokeObjectURL(url);
    state.discardFiles();
  });

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

  it('serializes an accepted-message clear after an in-flight draft write', async () => {
    const key = draftKey('R-sent');
    const state = new DraftState();
    state.switchKey(key, scope, 'R-sent');
    state.persistText('already sent', false);

    const write = state.flush();
    const clear = state.clearText();
    await Promise.all([write, clear]);

    const reopened = new DraftState();
    const legacy = reopened.switchKey(key, scope, 'R-sent');
    await expect(reopened.load(legacy)).resolves.toBeNull();
  });
});
