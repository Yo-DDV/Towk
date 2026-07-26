<!--
@component

Renders a LiveKit video track in a thumbnail-sized `<video>` element.
It can optionally include a small avatar overlay in the top-left corner for
identification.

Manages the attach/detach lifecycle imperatively — only detaches/reattaches
when the track reference actually changes, not on every parent re-render.
This prevents flicker from the 60ms audio level polling in VoiceCallPanel.

LiveKit's `adaptiveStream` observes the rendered `clientWidth/clientHeight` of
the attached `<video>` element, so this component must keep the video sized to
the actual tile rather than a hidden or detached placeholder.

**Props:**
- `track` - The LiveKit video Track to display
- `name` - Participant display name (shown as tooltip)
- `user` - User object for the avatar overlay (same shape as UserAvatar's `user` prop)
- `showIdentityOverlay` - Whether to show the avatar overlay
- `fill` - Whether the video should fill its parent's height instead of using thumbnail aspect-ratio sizing.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Track } from 'livekit-client';
  import type { PresenceStatus } from '$lib/render/types';
  import UserAvatar from '$lib/components/UserAvatar.svelte';

  let {
    track,
    name,
    user,
    showIdentityOverlay = true,
    fill = false
  }: {
    track: Track;
    name: string;
    user: {
      id: string;
      login: string;
      displayName: string;
      avatarUrl: string | null;
      presenceStatus: PresenceStatus;
    };
    showIdentityOverlay?: boolean;
    fill?: boolean;
  } = $props();

  let videoEl = $state<HTMLVideoElement | null>(null);

  // Track what's currently attached to avoid unnecessary detach/reattach cycles.
  // The parent's audio level polling (60ms) triggers $derived recalculations that
  // pass the same Track reference — we must not detach/reattach on those no-ops.
  let attachedTrack: Track | null = null;
  let attachedEl: HTMLVideoElement | null = null;

  $effect(() => {
    const t = track;
    const el = videoEl;

    if (t === attachedTrack && el === attachedEl) return;

    if (attachedTrack && attachedEl) {
      attachedTrack.detach(attachedEl);
    }

    if (t && el) {
      t.attach(el);
    }

    attachedTrack = t ?? null;
    attachedEl = el ?? null;
  });

  onDestroy(() => {
    if (attachedTrack && attachedEl) {
      attachedTrack.detach(attachedEl);
      attachedTrack = null;
      attachedEl = null;
    }
  });
</script>

<div
  class={[
    'relative block w-full overflow-hidden rounded-md',
    'bg-black',
    fill ? 'h-full min-h-0' : 'aspect-video'
  ]}
>
  <video
    bind:this={videoEl}
    width="640"
    height="360"
    class="h-full w-full object-contain"
    title={name}
    autoplay
    playsinline
    muted
  ></video>
  {#if showIdentityOverlay}
    <div
      class="absolute top-2 left-2 h-6 w-6 rounded-full shadow-[0_0_0_1.5px_var(--color-surface-100)]"
    >
      <UserAvatar {user} size="xs" />
    </div>
  {/if}
</div>
