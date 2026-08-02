<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import VoiceCallPanelStoryHarness from './VoiceCallPanelStoryHarness.svelte';

  const { Story } = defineMeta({
    title: 'Voice/Voice call panel',
    component: VoiceCallPanelStoryHarness,
    tags: ['autodocs'],
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'Composed call panel layouts rendered with deterministic in-memory call participants.'
        }
      }
    }
  });
</script>

<Story name="Stage with screen share" asChild>
  <div
    class="flex h-[720px] w-[1080px] overflow-hidden rounded-md border border-border bg-background"
  >
    <VoiceCallPanelStoryHarness layout="stage" scenario="screen" />
  </div>
</Story>

<Story name="Stage with one secondary tile" asChild>
  <div
    class="flex h-[720px] w-[1080px] overflow-hidden rounded-md border border-border bg-background"
  >
    <VoiceCallPanelStoryHarness layout="stage" scenario="screen-single-secondary" />
  </div>
</Story>

<Story name="Stage camera fallback" asChild>
  <div
    class="flex h-[720px] w-[1080px] overflow-hidden rounded-md border border-border bg-background"
  >
    <VoiceCallPanelStoryHarness layout="stage" scenario="camera" />
  </div>
</Story>

<Story name="Mobile camera controls" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="mobile-camera"
      simulateMobileCapabilities
    />
  </div>
</Story>

<Story name="Stage voice fallback" asChild>
  <div
    class="flex h-[720px] w-[1080px] overflow-hidden rounded-md border border-border bg-background"
  >
    <VoiceCallPanelStoryHarness layout="stage" scenario="voice" />
  </div>
</Story>

<Story name="Adaptive voice gallery" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="voice"
      participantCount={12}
      dockVariant="floating"
    />
  </div>
</Story>

<Story name="Adaptive three participant voice gallery" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="voice"
      participantCount={3}
      dockVariant="floating"
    />
  </div>
</Story>

<Story name="Simultaneous speaking participants" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="voice"
      participantCount={4}
      speakingParticipantIds={['gallery-1', 'gallery-2', 'gallery-3', 'gallery-4']}
      dockVariant="floating"
    />
  </div>
</Story>

<Story name="Adaptive single voice participant" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="voice"
      participantCount={1}
      dockVariant="floating"
    />
  </div>
</Story>

<Story name="Adaptive mixed camera gallery" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="camera"
      participantCount={9}
      dockVariant="floating"
    />
  </div>
</Story>

<Story name="Adaptive four participant mixed camera gallery" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="camera"
      participantCount={4}
      dockVariant="floating"
    />
  </div>
</Story>

<Story name="Adaptive screen share stage" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness layout="stage" scenario="screen" dockVariant="floating" />
  </div>
</Story>

<Story name="Adaptive screen share with companion devices" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness layout="stage" scenario="screen-devices" dockVariant="floating" />
  </div>
</Story>

<Story name="Adaptive dual screen share stage" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness layout="stage" scenario="dual-screen" dockVariant="floating" />
  </div>
</Story>

<Story name="Adaptive screen share with eight participants" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="screen"
      participantCount={8}
      dockVariant="floating"
    />
  </div>
</Story>

<Story name="Adaptive dual screen share with twelve participants" asChild>
  <div class="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
    <VoiceCallPanelStoryHarness
      layout="stage"
      scenario="dual-screen"
      participantCount={12}
      dockVariant="floating"
    />
  </div>
</Story>

<Story name="Sidebar" asChild>
  <div
    class="flex h-[720px] w-[360px] overflow-hidden rounded-md border border-border bg-background"
  >
    <VoiceCallPanelStoryHarness layout="sidebar" scenario="screen" />
  </div>
</Story>
