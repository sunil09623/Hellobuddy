export type MessageBlock = { blockerId: string; blockedId: string };
export type MessageDeliveryPolicy = 'deliver' | 'queue' | 'reject';

export function decideMessageDelivery(senderId: string, peerIds: string[], blocks: MessageBlock[]): MessageDeliveryPolicy {
  if (blocks.some(block => block.blockerId === senderId && peerIds.includes(block.blockedId))) return 'reject';
  const blockedPeers = blocks.filter(block => peerIds.includes(block.blockerId) && block.blockedId === senderId);
  if (!blockedPeers.length) return 'deliver';
  return peerIds.length === 1 ? 'queue' : 'reject';
}
