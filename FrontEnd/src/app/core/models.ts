export interface MessageDto {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  senderAvatarUrl?: string | null;
  content: string;
  createdAt: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentContentType?: string | null;
  attachmentSize?: number | null;
}

export interface ConversationDto {
  id: number;
  type: string;
  name: string;
  memberCount: number;
  isAdmin: boolean;
  otherUserId: number | null;
  otherAvatarUrl?: string | null;
  lastMessage: MessageDto | null;
}

export interface MemberDto {
  userId: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  isAdmin: boolean;
}   

export interface FriendDto {
  userId: number;
  username: string;
  displayName: string;
}

export interface FriendRequestDto {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  direction: 'incoming' | 'outgoing';
  createdAt: string;
}

export interface UserSearchDto {
  userId: number;
  username: string;
  displayName: string;
  relation: 'none' | 'friend' | 'incoming' | 'outgoing';
}


export interface ReadDto {
  userId: number;
  lastReadMessageId: number | null;
}

// ===== Phòng nghe nhạc (khớp với RoomDtos.cs) =====
export interface RoomTrackDto {
  trackId: number;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
  addedById: number;
}

export interface RoomMemberDto {
  userId: number;
  name: string;
  avatarUrl: string | null;
}

export interface RoomStateDto {
  id: string;
  name: string;
  hostId: number;
  members: RoomMemberDto[];
  queue: RoomTrackDto[];
  currentIndex: number;      // -1 = chưa có bài nào
  isPlaying: boolean;
  positionSeconds: number;   // vị trí phát tại thời điểm serverTimeMs
  serverTimeMs: number;
  version: number;           // bản cũ hơn thì bỏ qua
}

export interface RoomInviteDto {
  roomId: string;
  roomName: string;
  inviterId: number;
  inviterName: string;
}