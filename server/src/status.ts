export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
const rank: Record<MessageStatus, number> = { pending: 0, failed: 0, sent: 1, delivered: 2, read: 3 };
export function advanceStatus(current: MessageStatus, next: MessageStatus): MessageStatus {
  if (next === 'failed' && current === 'pending') return 'failed';
  return rank[next] > rank[current] ? next : current;
}
