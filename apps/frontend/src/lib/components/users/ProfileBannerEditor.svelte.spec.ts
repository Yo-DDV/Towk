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
});
