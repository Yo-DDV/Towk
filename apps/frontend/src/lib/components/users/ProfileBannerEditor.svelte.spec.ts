import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ProfileBannerEditor from './ProfileBannerEditor.svelte';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
  inspect: vi.fn()
}));

vi.mock('$lib/profileBanner', async () => {
  const actual = await vi.importActual<typeof import('$lib/profileBanner')>('$lib/profileBanner');
  return {
    ...actual,
    uploadProfileBanner: mocks.upload,
    deleteProfileBanner: mocks.remove,
    inspectProfileBannerDimensions: mocks.inspect
  };
});

const config = {
  serverId: 'server-1',
  baseUrl: 'https://towk.example/api/connect',
  bearerToken: 'token'
};

beforeEach(() => {
  mocks.upload.mockReset();
  mocks.remove.mockReset();
  mocks.inspect.mockReset();
  mocks.upload.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.inspect.mockResolvedValue({ width: 1536, height: 512 });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:profile-banner');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('ProfileBannerEditor', () => {
  it('renders the recommendation and accessible upload target', async () => {
    const { container } = render(ProfileBannerEditor, {
      props: {
        config,
        currentBannerUrl: null,
        onClose: vi.fn(),
        onChanged: vi.fn()
      }
    });

    await expect
      .element(container.querySelector<HTMLElement>('[data-testid="profile-banner-dropzone"]')!)
      .toBeVisible();
    expect(container.textContent).toContain('1536');
    expect(container.textContent).toContain('600');
    expect(container.textContent).toContain('No custom banner');
  });

  it('opens the file picker from keyboard activation', async () => {
    const { container } = render(ProfileBannerEditor, {
      props: {
        config,
        currentBannerUrl: null,
        onClose: vi.fn(),
        onChanged: vi.fn()
      }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const dropzone = container.querySelector<HTMLElement>(
      '[data-testid="profile-banner-dropzone"]'
    );
    if (!input || !dropzone) throw new Error('Expected banner input and dropzone.');
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});

    dropzone.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(click).toHaveBeenCalledOnce();
  });

  it('previews a valid selected image and saves it once', async () => {
    const onChanged = vi.fn();
    const { container } = render(ProfileBannerEditor, {
      props: {
        config,
        currentBannerUrl: null,
        onClose: vi.fn(),
        onChanged
      }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');
    const file = new File(['image'], 'banner.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledWith(file));
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    await vi.waitFor(() => expect(save.disabled).toBe(false));
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    save.click();

    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(config, file));
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('keeps destructive removal explicit and single-shot', async () => {
    const onChanged = vi.fn();
    const { container } = render(ProfileBannerEditor, {
      props: {
        config,
        currentBannerUrl: 'blob:current-banner',
        onClose: vi.fn(),
        onChanged
      }
    });
    const remove = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Remove banner')
    );
    if (!remove) throw new Error('Expected remove banner button.');
    remove.click();

    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('clears a previous valid selection when the replacement is invalid', async () => {
    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');

    const valid = new File(['image'], 'valid.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [valid] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledWith(valid));

    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    await vi.waitFor(() => expect(save.disabled).toBe(false));

    const invalid = new File(['svg'], 'invalid.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input, 'files', { configurable: true, value: [invalid] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(save.disabled).toBe(true));
    expect(container.textContent).toContain('JPEG, PNG or WebP');
  });

  it('keeps only the latest asynchronous selection result', async () => {
    let resolveFirst!: (dimensions: { width: number; height: number }) => void;
    const firstResult = new Promise<{ width: number; height: number }>((resolve) => {
      resolveFirst = resolve;
    });
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    const createObjectURL = vi.mocked(URL.createObjectURL);
    createObjectURL.mockClear();
    mocks.inspect.mockImplementation((file: File) =>
      file === first ? firstResult : Promise.resolve({ width: 1800, height: 600 })
    );

    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');

    Object.defineProperty(input, 'files', { configurable: true, value: [first] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    Object.defineProperty(input, 'files', { configurable: true, value: [second] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(createObjectURL.mock.calls[0]?.[0]).toBe(second);
    resolveFirst({ width: 1536, height: 512 });
    await Promise.resolve();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    save.click();
    await vi.waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(config, second));
  });

  it('rejects decoded dimensions below the server minimum', async () => {
    mocks.inspect.mockResolvedValue({ width: 599, height: 200 });
    const { container } = render(ProfileBannerEditor, {
      props: { config, currentBannerUrl: null, onClose: vi.fn(), onChanged: vi.fn() }
    });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Expected banner file input.');
    const file = new File(['image'], 'small.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => expect(container.textContent).toContain('600'));
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Save banner')
    );
    if (!save) throw new Error('Expected save banner button.');
    expect(save.disabled).toBe(true);
  });
});
