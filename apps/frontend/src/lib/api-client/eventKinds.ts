export const RoomEventKind = {
  CallEnded: 'callEnded',
  CallParticipantJoined: 'callParticipantJoined',
  CallParticipantLeft: 'callParticipantLeft',
  CallStarted: 'callStarted',
  MessagePosted: 'messagePosted',
  RoomArchived: 'roomArchived',
  RoomCreated: 'roomCreated',
  RoomDeleted: 'roomDeleted',
  RoomHistoryPurged: 'roomHistoryPurged',
  RoomPostingPolicyChanged: 'roomPostingPolicyChanged',
  RoomUnarchived: 'roomUnarchived',
  RoomUpdated: 'roomUpdated',
  UserJoinedRoom: 'userJoinedRoom',
  UserLeftRoom: 'userLeftRoom'
} as const;

export type RoomEventKind = (typeof RoomEventKind)[keyof typeof RoomEventKind];
