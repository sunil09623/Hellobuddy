import { describe, it, expect } from 'vitest';
import { advanceStatus } from './status.js';
describe('message status progression', () => {
 it('progresses monotonically', () => { expect(advanceStatus('sent','delivered')).toBe('delivered'); expect(advanceStatus('delivered','read')).toBe('read'); expect(advanceStatus('read','sent')).toBe('read'); });
 it('allows failure only while pending and prevents downgrade', () => { expect(advanceStatus('pending','failed')).toBe('failed'); expect(advanceStatus('sent','failed')).toBe('sent'); });
});
