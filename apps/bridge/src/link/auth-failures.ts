interface Window {
  startedAt: number;
  count: number;
}

export interface AuthFailureLimits {
  maxPerWindow: number;
  windowMs: number;
}

/** Failed key checks per address in fixed windows, in memory: an address at `maxPerWindow` is locked out until its window ends. Expired windows are dropped as new failures arrive, so the table holds only recently failing addresses. */
export class AuthFailures {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limits: AuthFailureLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one failure; returns the count in the address's current window. */
  record(address: string): number {
    this.dropExpired();
    const window = this.windows.get(address) ?? {
      startedAt: this.now(),
      count: 0,
    };
    window.count += 1;
    this.windows.set(address, window);
    return window.count;
  }

  isLocked(address: string): boolean {
    const window = this.windows.get(address);
    return (
      !!window &&
      !this.isExpired(window) &&
      window.count >= this.limits.maxPerWindow
    );
  }

  private isExpired(window: Window): boolean {
    return this.now() - window.startedAt >= this.limits.windowMs;
  }

  private dropExpired(): void {
    for (const [address, window] of this.windows)
      if (this.isExpired(window)) this.windows.delete(address);
  }
}
