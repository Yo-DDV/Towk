<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ProfileBannerEditor from './ProfileBannerEditor.svelte';

  const { Story } = defineMeta({
    title: 'Components/Users/ProfileBannerEditor',
    component: ProfileBannerEditor,
    tags: ['autodocs']
  });

  const config = {
    serverId: 'story-server',
    baseUrl: '/api/connect',
    bearerToken: 'story-token'
  };
  const noop = () => {};
</script>

<Story name="Empty banner" asChild>
  <div class="mx-auto w-full max-w-3xl bg-surface-100 p-4 sm:p-8">
    <ProfileBannerEditor {config} currentBannerUrl={null} onClose={noop} onChanged={noop} />
  </div>
</Story>
