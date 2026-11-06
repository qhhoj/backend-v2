import type { Env } from '@libs/common';
import { EventStreamHubService } from './event-stream-hub.service';
import { DEFAULT_STREAM_LIMITS } from './stream-limits';
import type { StreamLimits } from './stream-limits';

const LIMITS: StreamLimits = {
  ...DEFAULT_STREAM_LIMITS,
  perIp: 16,
  perAllowlistedIp: 40,
  perUser: 1000,
  total: 1000,
};

const hubWith = (allowlist: string[], limits = LIMITS) =>
  new EventStreamHubService(
    { sseIpAllowlist: allowlist } as Env,
    limits,
    null as never,
    null as never,
    null as never,
  );

/** Reserves slots for `ip` until refused; the number granted. */
function openUntilRefused(hub: EventStreamHubService, ip: string): number {
  let opened = 0;
  for (;;) {
    try {
      hub.reserve(ip, null);
    } catch {
      return opened;
    }
    opened += 1;
  }
}

describe('per-IP stream cap with SSE_IP_ALLOWLIST', () => {
  it('lets an allowlisted IP open streams up to the higher cap and refuses beyond it', () => {
    const hub = hubWith(['203.0.113.7']);
    expect(openUntilRefused(hub, '203.0.113.7')).toBe(40);
  });

  it('keeps the normal cap for other IPs', () => {
    const hub = hubWith(['203.0.113.7']);
    expect(openUntilRefused(hub, '198.51.100.1')).toBe(16);
  });

  it('still applies the total cap to an allowlisted IP', () => {
    const hub = hubWith(['203.0.113.7'], { ...LIMITS, total: 20 });
    expect(openUntilRefused(hub, '203.0.113.7')).toBe(20);
  });

  it('still applies the per-user cap to an allowlisted IP', () => {
    const hub = hubWith(['203.0.113.7'], { ...LIMITS, perUser: 3 });
    const granted = Array.from({ length: 5 }, () => {
      try {
        hub.reserve('203.0.113.7', 'u1');
        return true;
      } catch {
        return false;
      }
    });
    expect(granted).toEqual([true, true, true, false, false]);
  });
});
