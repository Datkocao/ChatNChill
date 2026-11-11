export interface MessageDto {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
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
  lastMessage: MessageDto | null;
}

export interface MemberDto {
  userId: number;
  username: string;
  displayName: string;
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