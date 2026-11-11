export interface MessageDto {
  id: number;
  conversationId: number;
  senderId: number;
  senderName: string;
  content: string;
  createdAt: string;
}

export interface ConversationDto {
  id: number;
  type: string;
  name: string;
  memberCount: number;
  isAdmin: boolean;
  lastMessage: MessageDto | null;
}

export interface MemberDto {
  userId: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}   