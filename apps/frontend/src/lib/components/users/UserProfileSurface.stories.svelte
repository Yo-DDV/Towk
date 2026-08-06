<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { DetailedUserProfile } from '$lib/api-client/memberDirectory';
  import { PresenceStatus } from '$lib/render/types';
  import UserProfileSurface from './UserProfileSurface.svelte';
  import './UserProfileSurface.polish.css';

  const { Story } = defineMeta({
    title: 'Components/Users/UserProfileSurface',
    component: UserProfileSurface,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Responsive, presentation-only surface for the canonical detailed user profile. The owning dialog supplies loading, capability, history, and navigation behavior.'
        }
      }
    }
  });

  const baseProfile: DetailedUserProfile = {
    user: {
      id: 'story-profile-user',
      login: 'alex.morgan',
      displayName: 'Alex Morgan',
      deleted: false,
      avatarUrl: null,
      presenceStatus: PresenceStatus.Online,
      customStatus: {
        emoji: '🧭',
        text: 'Mapping the next release',
        expiresAt: null
      }
    },
    roles: [
      {
        name: 'community-moderator',
        displayName: 'Community moderator',
        position: 20,
        moderation: true
      },
      {
        name: 'design-system',
        displayName: 'Design system',
        position: 10,
        moderation: false
      }
    ],
    joinedAt: '2025-11-14T09:30:00.000Z',
    biographyMarkdown:
      'Building calm, accessible communication tools.\n\n**Current focus:** responsive interaction patterns, design systems, and product quality.',
    lastActivity: '2026-08-03T08:42:00.000Z',
    lastActivityVisible: true,
    viewerIsSelf: false,
    viewerCanMessage: true,
    viewerCanCall: true
  };

  const minimalProfile: DetailedUserProfile = {
    ...baseProfile,
    user: {
      ...baseProfile.user,
      id: 'story-minimal-user',
      login: 'sam',
      displayName: 'Sam',
      presenceStatus: PresenceStatus.Offline,
      customStatus: null
    },
    roles: [],
    biographyMarkdown: '',
    lastActivity: null,
    lastActivityVisible: true,
    viewerIsSelf: false,
    viewerCanMessage: false,
    viewerCanCall: false
  };

  const longContentProfile: DetailedUserProfile = {
    ...baseProfile,
    user: {
      ...baseProfile.user,
      login: 'alexandra-with-a-deliberately-long-login-for-layout-qualification',
      displayName:
        'Alexandra Morgan With a Deliberately Long Display Name for Responsive Qualification',
      customStatus: {
        emoji: '🛠️',
        text: 'Reviewing a long localized interface label without clipping important controls',
        expiresAt: null
      }
    },
    roles: Array.from({ length: 10 }, (_, index) => ({
      name: `role-${index + 1}`,
      displayName:
        index === 2
          ? 'Extremely long configured role name that must remain bounded'
          : `Configured role ${index + 1}`,
      position: 20 - index,
      moderation: index < 2
    })),
    biographyMarkdown: Array.from(
      { length: 18 },
      (_, index) =>
        `## Profile section ${index + 1}\n\nThis is a deliberately long Markdown paragraph used to verify bounded preview, wrapping, and expansion without changing the stored biography.`
    ).join('\n\n'),
    lastActivityVisible: false,
    lastActivity: null
  };

  const bannerStoryUrl =
    'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221536%22 height=%22512%22 viewBox=%220 0 1536 512%22%3E%3Cdefs%3E%3ClinearGradient id=%22g%22 x1=%220%22 y1=%220%22 x2=%221%22 y2=%221%22%3E%3Cstop stop-color=%22%234d5157%22/%3E%3Cstop offset=%221%22 stop-color=%22%231d1f22%22/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width=%221536%22 height=%22512%22 fill=%22url(%23g)%22/%3E%3Ccircle cx=%221160%22 cy=%22120%22 r=%22240%22 fill=%22none%22 stroke=%22%23ffffff%22 stroke-opacity=%22.18%22 stroke-width=%2212%22/%3E%3C/svg%3E';

  const noop = () => {};
</script>

<script lang="ts">
  import { createPresenceCache } from '$lib/state/presenceCache.svelte';
  import { createUserProfileCache } from '$lib/state/userProfiles.svelte';

  createUserProfileCache();
  createPresenceCache();
</script>

<Story
  name="Complete profile"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Default loaded state with custom status, moderation role, direct-message and call capabilities.'
      }
    }
  }}
>
  <div class="mx-auto w-full max-w-4xl bg-surface-100 p-4 sm:p-8">
    <UserProfileSurface
      user={baseProfile.user}
      profile={baseProfile}
      loading={false}
      loadError=""
      canSendMessage
      canCall
      onEditProfile={noop}
      onSendMessage={noop}
      onCall={noop}
      onBanFromRoom={noop}
    />
  </div>
</Story>

<Story
  name="Custom banner"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Authenticated self-profile with a wide custom banner and its accessible edit affordance.'
      }
    }
  }}
>
  <div class="mx-auto w-full max-w-4xl bg-surface-100 p-4 sm:p-8">
    <UserProfileSurface
      user={baseProfile.user}
      profile={{ ...baseProfile, viewerIsSelf: true }}
      loading={false}
      loadError=""
      bannerUrl={bannerStoryUrl}
      canEditBanner
      canEditProfile
      onEditBanner={noop}
      onEditProfile={noop}
      onSendMessage={noop}
      onCall={noop}
      onBanFromRoom={noop}
    />
  </div>
</Story>

<Story
  name="Long responsive content"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Long identity, status, configured roles, hidden activity, and Markdown exercise wrapping and the bounded biography preview.'
      }
    }
  }}
>
  <div class="mx-auto w-full max-w-4xl bg-surface-100 p-4 sm:p-8">
    <UserProfileSurface
      user={longContentProfile.user}
      profile={longContentProfile}
      loading={false}
      loadError=""
      canEditProfile
      canSendMessage
      canCall
      canBanFromRoom
      onEditProfile={noop}
      onSendMessage={noop}
      onCall={noop}
      onBanFromRoom={noop}
    />
  </div>
</Story>

<Story
  name="Minimal profile"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Offline identity with no custom status, no explicit role, no recent activity, no biography, and no available action.'
      }
    }
  }}
>
  <div class="mx-auto w-full max-w-4xl bg-surface-100 p-4 sm:p-8">
    <UserProfileSurface
      user={minimalProfile.user}
      profile={minimalProfile}
      loading={false}
      loadError=""
      onEditProfile={noop}
      onSendMessage={noop}
      onCall={noop}
      onBanFromRoom={noop}
    />
  </div>
</Story>

<Story
  name="Compact phone width"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A 20rem qualification frame exercises the narrow container query with long identity, roles, status, and every capability-filtered action.'
      }
    }
  }}
>
  <div class="mx-auto w-80 max-w-full bg-surface-100 p-0">
    <UserProfileSurface
      user={longContentProfile.user}
      profile={longContentProfile}
      loading={false}
      loadError=""
      canEditProfile
      canSendMessage
      canCall
      canBanFromRoom
      onEditProfile={noop}
      onSendMessage={noop}
      onCall={noop}
      onBanFromRoom={noop}
    />
  </div>
</Story>

<Story
  name="Loading"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Identity remains stable while role, account-fact, and biography geometry is loading.'
      }
    }
  }}
>
  <div class="mx-auto w-full max-w-4xl bg-surface-100 p-4 sm:p-8">
    <UserProfileSurface
      user={baseProfile.user}
      profile={null}
      loading
      loadError=""
      canSendMessage
      onEditProfile={noop}
      onSendMessage={noop}
      onCall={noop}
      onBanFromRoom={noop}
    />
  </div>
</Story>

<Story
  name="Moderation action busy"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The destructive room action keeps stable geometry, disables repeated activation, and exposes its busy state while the request is pending.'
      }
    }
  }}
>
  <div class="mx-auto w-full max-w-4xl bg-surface-100 p-4 sm:p-8">
    <UserProfileSurface
      user={baseProfile.user}
      profile={baseProfile}
      loading={false}
      loadError=""
      canSendMessage
      canCall
      canBanFromRoom
      banningFromRoom
      onEditProfile={noop}
      onSendMessage={noop}
      onCall={noop}
      onBanFromRoom={noop}
    />
  </div>
</Story>

<Story
  name="Unavailable"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Bounded unavailable state keeps fallback identity and any caller-supplied safe action visible.'
      }
    }
  }}
>
  <div class="mx-auto w-full max-w-4xl bg-surface-100 p-4 sm:p-8">
    <UserProfileSurface
      user={baseProfile.user}
      profile={null}
      loading={false}
      loadError="Could not load this profile."
      canSendMessage
      onEditProfile={noop}
      onSendMessage={noop}
      onCall={noop}
      onBanFromRoom={noop}
    />
  </div>
</Story>
