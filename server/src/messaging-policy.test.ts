import { describe, expect, it } from 'vitest';
import { decideMessageDelivery } from './messaging-policy.js';

describe('message delivery policy', () => {
  it('delivers normally when neither participant has blocked the sender', () => {
    expect(decideMessageDelivery('sender', ['recipient'], [])).toBe('deliver');
  });

  it('queues a message when its recipient has blocked the sender', () => {
    expect(decideMessageDelivery('sender', ['recipient'], [{ blockerId: 'recipient', blockedId: 'sender' }])).toBe('queue');
  });

  it('rejects a message from a user who blocked the recipient', () => {
    expect(decideMessageDelivery('sender', ['recipient'], [{ blockerId: 'sender', blockedId: 'recipient' }])).toBe('reject');
  });

  it('rejects a message when both participants have blocked each other', () => {
    expect(decideMessageDelivery('sender', ['recipient'], [
      { blockerId: 'sender', blockedId: 'recipient' },
      { blockerId: 'recipient', blockedId: 'sender' }
    ])).toBe('reject');
  });

  it('does not queue a group message when one recipient has blocked the sender', () => {
    expect(decideMessageDelivery('sender', ['first', 'second'], [{ blockerId: 'first', blockedId: 'sender' }])).toBe('reject');
  });
});
