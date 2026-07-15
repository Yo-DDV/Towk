import { describe, expect, it } from 'vitest';
import {
  callNotificationClickUrl,
  normalizeCallPushNotification,
  type CallPushPayload
} from './callNotification.worker';

const payload: CallPushPayload = {
  actorName: 'Alice',
  actorKnown: true,
  roomName: 'Général',
  isPrivate: false,
  callId: 'C123',
  joinUrl: 'https://towk.example/chat/-/R1?joinCall=C123'
};

describe('call push notifications', () => {
  it.each([
    ['en-US', 'Alice started a call', 'In #Général', 'View room', 'Join'],
    ['fr-FR', 'Alice a démarré un appel', 'Dans #Général', 'Voir le salon', 'Rejoindre'],
    ['de-DE', 'Alice hat einen Anruf gestartet', 'In #Général', 'Raum anzeigen', 'Beitreten'],
    ['es-ES', 'Alice inició una llamada', 'En #Général', 'Ver sala', 'Unirse'],
    ['pt-BR', 'Alice iniciou uma chamada', 'Em #Général', 'Ver sala', 'Entrar']
  ])('localizes channel calls for %s', (locale, title, body, view, join) => {
    const notification = normalizeCallPushNotification(
      {
        url: 'https://towk.example/chat/-/R1',
        tag: 'call-C123',
        expiresAt: 10_000,
        call: payload
      },
      9_000,
      locale
    );

    expect(notification).toMatchObject({
      title,
      options: {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-monochrome-96.png',
        tag: 'call-C123',
        data: {
          url: 'https://towk.example/chat/-/R1',
          joinUrl: payload.joinUrl,
          callId: payload.callId
        },
        actions: [
          { action: 'view-room', title: view },
          { action: 'join-call', title: join }
        ]
      }
    });
  });

  it('uses private-conversation wording and English as a safe fallback', () => {
    const notification = normalizeCallPushNotification(
      {
        url: 'https://towk.example/chat/-/DM1',
        expiresAt: 10_000,
        call: {
          ...payload,
          isPrivate: true,
          roomName: '',
          joinUrl: 'https://towk.example/chat/-/DM1?joinCall=C123'
        }
      },
      9_000,
      'ja-JP'
    );

    expect(notification).toMatchObject({
      title: 'Alice is calling you',
      options: {
        body: 'Private conversation',
        actions: [
          { action: 'view-room', title: 'View conversation' },
          { action: 'join-call', title: 'Join' }
        ]
      }
    });
  });

  it('applies native notification metadata to calls', () => {
    const notification = normalizeCallPushNotification(
      {
        url: 'https://towk.example/chat/-/R1',
        tag: 'call-C123',
        lang: 'fr',
        dir: 'ltr',
        timestamp: 1783936800000,
        expiresAt: 10_000,
        call: payload
      },
      9_000,
      'fr'
    );

    expect(notification).toMatchObject({
      title: 'Alice a démarré un appel',
      options: {
        lang: 'fr',
        dir: 'ltr',
        timestamp: 1783936800000,
        renotify: true,
        requireInteraction: true
      }
    });
  });

  it('omits optional native metadata when a call push does not provide a usable value', () => {
    const notification = normalizeCallPushNotification(
      {
        url: 'https://towk.example/chat/-/R1',
        lang: '   ',
        timestamp: Number.NaN,
        renotify: true,
        requireInteraction: false,
        expiresAt: 10_000,
        call: payload
      },
      9_000,
      'fr'
    );

    expect(notification?.options).not.toHaveProperty('lang');
    expect(notification?.options).not.toHaveProperty('timestamp');
    expect(notification?.options).not.toHaveProperty('renotify');
    expect(notification?.options).not.toHaveProperty('requireInteraction');
  });

  it.each([
    ['en', 'Incoming call'],
    ['fr', 'Appel entrant'],
    ['de', 'Eingehender Anruf'],
    ['es', 'Llamada entrante'],
    ['pt', 'Chamada recebida']
  ])('localizes an unknown private caller for %s', (locale, title) => {
    const notification = normalizeCallPushNotification(
      {
        url: 'https://towk.example/chat/-/DM1',
        expiresAt: 10_000,
        call: {
          ...payload,
          actorName: 'Someone',
          actorKnown: false,
          isPrivate: true,
          joinUrl: 'https://towk.example/chat/-/DM1?joinCall=C123'
        }
      },
      9_000,
      locale
    );
    expect(notification?.title).toBe(title);
  });

  it('drops expired or malformed call pushes before displaying them', () => {
    expect(
      normalizeCallPushNotification(
        { url: 'https://towk.example/chat/-/R1', expiresAt: 9_000, call: payload },
        9_000,
        'fr'
      )
    ).toBeNull();
    expect(
      normalizeCallPushNotification(
        {
          url: 'https://towk.example/chat/-/R1',
          expiresAt: 10_000,
          call: { ...payload, callId: '', joinUrl: '' }
        },
        9_000,
        'fr'
      )
    ).toBeNull();
    expect(
      normalizeCallPushNotification(
        {
          url: 'https://towk.example/chat/-/R1',
          expiresAt: 10_000,
          call: { ...payload, joinUrl: 'https://towk.example/chat/-/R2?joinCall=C123' }
        },
        9_000,
        'fr'
      )
    ).toBeNull();
  });

  it('keeps the main click non-joining and routes only the explicit join action', () => {
    const data = {
      url: 'https://towk.example/chat/-/R1',
      joinUrl: payload.joinUrl
    };
    expect(callNotificationClickUrl(data, '')).toBe(data.url);
    expect(callNotificationClickUrl(data, 'view-room')).toBe(data.url);
    expect(callNotificationClickUrl(data, 'join-call')).toBe(data.joinUrl);
  });
});
