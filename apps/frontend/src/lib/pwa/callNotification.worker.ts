export type CallPushPayload = {
  actorName: string;
  actorKnown?: boolean;
  roomName?: string;
  isPrivate?: boolean;
  callId: string;
  joinUrl: string;
};

export type CallPushEnvelope = {
  url?: string;
  tag?: string;
  notificationId?: string;
  expiresAt?: number;
  call?: CallPushPayload;
};

export type NormalizedCallPushNotification = {
  title: string;
  options: ActionableNotificationOptions;
};

type ActionableNotificationOptions = NotificationOptions & {
  // Notification actions are implemented by Chromium and some other engines,
  // but are still missing from parts of TypeScript's Web Worker declarations.
  actions?: Array<{ action: string; title: string; icon?: string }>;
};

type CallCopy = {
  channelTitle: (actor: string) => string;
  privateTitle: (actor: string) => string;
  unknownChannelTitle: string;
  unknownPrivateTitle: string;
  channelBody: (room: string) => string;
  privateBody: string;
  viewRoom: string;
  viewConversation: string;
  join: string;
};

const COPY: Record<string, CallCopy> = {
  en: {
    channelTitle: (actor) => `${actor} started a call`,
    privateTitle: (actor) => `${actor} is calling you`,
    unknownChannelTitle: 'A call started',
    unknownPrivateTitle: 'Incoming call',
    channelBody: (room) => `In #${room}`,
    privateBody: 'Private conversation',
    viewRoom: 'View room',
    viewConversation: 'View conversation',
    join: 'Join'
  },
  fr: {
    channelTitle: (actor) => `${actor} a démarré un appel`,
    privateTitle: (actor) => `${actor} vous appelle`,
    unknownChannelTitle: 'Un appel a démarré',
    unknownPrivateTitle: 'Appel entrant',
    channelBody: (room) => `Dans #${room}`,
    privateBody: 'Conversation privée',
    viewRoom: 'Voir le salon',
    viewConversation: 'Voir la conversation',
    join: 'Rejoindre'
  },
  de: {
    channelTitle: (actor) => `${actor} hat einen Anruf gestartet`,
    privateTitle: (actor) => `${actor} ruft dich an`,
    unknownChannelTitle: 'Ein Anruf wurde gestartet',
    unknownPrivateTitle: 'Eingehender Anruf',
    channelBody: (room) => `In #${room}`,
    privateBody: 'Private Unterhaltung',
    viewRoom: 'Raum anzeigen',
    viewConversation: 'Unterhaltung anzeigen',
    join: 'Beitreten'
  },
  es: {
    channelTitle: (actor) => `${actor} inició una llamada`,
    privateTitle: (actor) => `${actor} te está llamando`,
    unknownChannelTitle: 'Se inició una llamada',
    unknownPrivateTitle: 'Llamada entrante',
    channelBody: (room) => `En #${room}`,
    privateBody: 'Conversación privada',
    viewRoom: 'Ver sala',
    viewConversation: 'Ver conversación',
    join: 'Unirse'
  },
  pt: {
    channelTitle: (actor) => `${actor} iniciou uma chamada`,
    privateTitle: (actor) => `${actor} está ligando para você`,
    unknownChannelTitle: 'Uma chamada foi iniciada',
    unknownPrivateTitle: 'Chamada recebida',
    channelBody: (room) => `Em #${room}`,
    privateBody: 'Conversa privada',
    viewRoom: 'Ver sala',
    viewConversation: 'Ver conversa',
    join: 'Entrar'
  }
};

export function normalizeCallPushNotification(
  envelope: CallPushEnvelope,
  now = Date.now(),
  locale = 'en'
): NormalizedCallPushNotification | null {
  const call = envelope.call;
  if (
    !call ||
    typeof envelope.expiresAt !== 'number' ||
    !Number.isFinite(envelope.expiresAt) ||
    envelope.expiresAt <= now ||
    !nonEmpty(envelope.url) ||
    (call.actorKnown === true && !nonEmpty(call.actorName)) ||
    !nonEmpty(call.callId) ||
    !validJoinURL(envelope.url, call.joinUrl, call.callId)
  ) {
    return null;
  }

  const copy = COPY[locale.toLowerCase().split('-')[0]] ?? COPY.en;
  const isPrivate = call.isPrivate === true;
  const actorKnown = call.actorKnown === true;
  const roomName = call.roomName?.trim() || 'Room';
  return {
    title: actorKnown
      ? isPrivate
        ? copy.privateTitle(call.actorName.trim())
        : copy.channelTitle(call.actorName.trim())
      : isPrivate
        ? copy.unknownPrivateTitle
        : copy.unknownChannelTitle,
    options: {
      body: isPrivate ? copy.privateBody : copy.channelBody(roomName),
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-monochrome-96.png',
      tag: envelope.tag,
      data: {
        notificationId: envelope.notificationId,
        url: envelope.url,
        joinUrl: call.joinUrl,
        callId: call.callId
      },
      actions: [
        { action: 'view-room', title: isPrivate ? copy.viewConversation : copy.viewRoom },
        { action: 'join-call', title: copy.join }
      ]
    }
  };
}

export function callNotificationClickUrl(
  data: { url?: unknown; joinUrl?: unknown } | null | undefined,
  action: string
): string | undefined {
  if (action === 'join-call' && typeof data?.joinUrl === 'string') return data.joinUrl;
  return typeof data?.url === 'string' ? data.url : undefined;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function validJoinURL(viewURL: string, joinURL: string, callID: string): boolean {
  if (!nonEmpty(joinURL)) return false;
  try {
    const view = new URL(viewURL, 'https://towk.invalid');
    const join = new URL(joinURL, view);
    return (
      join.origin === view.origin &&
      join.pathname === view.pathname &&
      join.searchParams.get('joinCall') === callID
    );
  } catch {
    return false;
  }
}
