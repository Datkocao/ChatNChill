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
  lastMessage: MessageDto | null;
}