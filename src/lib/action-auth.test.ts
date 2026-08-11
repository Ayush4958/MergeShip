import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireUser, requireMaintainer, requireMaintainerAuth } from './action-auth';

const mocks = vi.hoisted(() => ({
  mockGetServerSupabase: vi.fn(),
  mockGetServiceSupabase: vi.fn(),
  mockGetUser: vi.fn(),
  mockRateLimit: vi.fn(),
  mockIsUserMaintainer: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: mocks.mockGetServerSupabase,
}));

vi.mock('@/lib/supabase/service', () => ({
  getServiceSupabase: mocks.mockGetServiceSupabase,
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: mocks.mockRateLimit,
}));

vi.mock('@/lib/maintainer/detect', () => ({
  isUserMaintainer: mocks.mockIsUserMaintainer,
}));

const FAKE_USER = { id: 'user-123', email: 'test@example.com' };

describe('requireUser', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: Supabase is configured, user is authenticated
    mocks.mockGetServerSupabase.mockResolvedValue({
      auth: { getUser: mocks.mockGetUser },
    });
    mocks.mockGetUser.mockResolvedValue({ data: { user: FAKE_USER } });
  });

  it('returns not_configured when getServerSupabase returns null', async () => {
    mocks.mockGetServerSupabase.mockResolvedValue(null);

    const res = await requireUser();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('not_configured');
      expect(res.error.message).toBe('auth not configured');
    }
  });

  it('returns not_authenticated when no user is signed in', async () => {
    mocks.mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await requireUser();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('not_authenticated');
      expect(res.error.message).toBe('sign in first');
    }
  });

  it('returns the user and sb client when called with no opts', async () => {
    const res = await requireUser();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.user).toEqual(FAKE_USER);
      expect(res.data.sb).toBeDefined();
      expect(res.data.service).toBeNull();
    }
    // No rate limiting should fire without opts
    expect(mocks.mockRateLimit).not.toHaveBeenCalled();
  });

  // --- requireService ---

  it('returns not_configured when requireService is true but service is null', async () => {
    mocks.mockGetServiceSupabase.mockReturnValue(null);

    const res = await requireUser({ requireService: true });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('not_configured');
      expect(res.error.message).toBe('service role missing');
    }
  });

  it('returns service client when requireService is true and configured', async () => {
    const fakeService = { from: vi.fn() };
    mocks.mockGetServiceSupabase.mockReturnValue(fakeService);

    const res = await requireUser({ requireService: true });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.service).toBe(fakeService);
    }
  });

  it('does not call getServiceSupabase when requireService is falsy', async () => {
    await requireUser();

    expect(mocks.mockGetServiceSupabase).not.toHaveBeenCalled();
  });

  // --- Rate limiting ---

  it('returns rate_limited when rate limit is exceeded', async () => {
    const resetAt = Date.now() + 60_000;
    mocks.mockRateLimit.mockResolvedValue({ ok: false, remaining: 0, resetAt });

    const res = await requireUser({
      rateLimit: { namespace: 'test', limit: 10, windowSec: 60 },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('rate_limited');
      expect(res.error.message).toBe('slow down');
      expect(res.error.retryable).toBe(true);
      expect(res.error.resetAt).toBe(resetAt);
    }
  });

  it('uses custom rateLimitMessage when provided', async () => {
    mocks.mockRateLimit.mockResolvedValue({ ok: false, remaining: 0, resetAt: 0 });

    const res = await requireUser({
      rateLimit: { namespace: 'test', limit: 5, windowSec: 60 },
      rateLimitMessage: 'too many requests, chill',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toBe('too many requests, chill');
    }
  });

  it('passes through when rate limit is ok', async () => {
    mocks.mockRateLimit.mockResolvedValue({ ok: true, remaining: 9, resetAt: 0 });

    const res = await requireUser({
      rateLimit: { namespace: 'test', limit: 10, windowSec: 60 },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.user).toEqual(FAKE_USER);
    }
  });

  it('passes the correct namespace, key, limit, and windowSec to rateLimit', async () => {
    mocks.mockRateLimit.mockResolvedValue({ ok: true, remaining: 5, resetAt: 0 });

    await requireUser({
      rateLimit: { namespace: 'leaderboard', limit: 30, windowSec: 120 },
    });

    expect(mocks.mockRateLimit).toHaveBeenCalledWith({
      namespace: 'leaderboard',
      key: FAKE_USER.id,
      limit: 30,
      windowSec: 120,
    });
  });

  it('does not call rateLimit when opts.rateLimit is undefined', async () => {
    await requireUser({});

    expect(mocks.mockRateLimit).not.toHaveBeenCalled();
  });

  // --- Order of operations ---

  it('checks auth before rate limiting (no rateLimit call if user is null)', async () => {
    mocks.mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await requireUser({
      rateLimit: { namespace: 'test', limit: 10, windowSec: 60 },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not_authenticated');
    expect(mocks.mockRateLimit).not.toHaveBeenCalled();
  });

  it('checks service availability before auth when requireService is set', async () => {
    mocks.mockGetServiceSupabase.mockReturnValue(null);

    const res = await requireUser({ requireService: true });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not_configured');
    // getUser should not have been called because service check failed first
    expect(mocks.mockGetUser).not.toHaveBeenCalled();
  });
});

describe('requireMaintainer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.mockGetServerSupabase.mockResolvedValue({
      auth: { getUser: mocks.mockGetUser },
    });
    mocks.mockGetUser.mockResolvedValue({ data: { user: FAKE_USER } });
  });

  it('returns the user when they are a maintainer', async () => {
    mocks.mockIsUserMaintainer.mockResolvedValue(true);

    const res = await requireMaintainer();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.user).toEqual(FAKE_USER);
    }
    expect(mocks.mockIsUserMaintainer).toHaveBeenCalledWith(FAKE_USER.id);
  });

  it('returns not_authorised when user is not a maintainer', async () => {
    mocks.mockIsUserMaintainer.mockResolvedValue(false);

    const res = await requireMaintainer();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('not_authorised');
      expect(res.error.message).toBe('not a maintainer');
    }
  });

  it('propagates requireUser errors (not_authenticated) without checking maintainer status', async () => {
    mocks.mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await requireMaintainer();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not_authenticated');
    // isUserMaintainer should never be called if requireUser fails
    expect(mocks.mockIsUserMaintainer).not.toHaveBeenCalled();
  });

  it('propagates requireUser errors (not_configured) without checking maintainer status', async () => {
    mocks.mockGetServerSupabase.mockResolvedValue(null);

    const res = await requireMaintainer();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not_configured');
    expect(mocks.mockIsUserMaintainer).not.toHaveBeenCalled();
  });

  it('propagates rate_limited errors when rate limit opts are passed', async () => {
    mocks.mockRateLimit.mockResolvedValue({ ok: false, remaining: 0, resetAt: 0 });

    const res = await requireMaintainer({
      rateLimit: { namespace: 'maintainer', limit: 5, windowSec: 60 },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('rate_limited');
    expect(mocks.mockIsUserMaintainer).not.toHaveBeenCalled();
  });

  it('passes opts through to requireUser (requireService + rateLimit)', async () => {
    const fakeService = { from: vi.fn() };
    mocks.mockGetServiceSupabase.mockReturnValue(fakeService);
    mocks.mockRateLimit.mockResolvedValue({ ok: true, remaining: 4, resetAt: 0 });
    mocks.mockIsUserMaintainer.mockResolvedValue(true);

    const res = await requireMaintainer({
      requireService: true,
      rateLimit: { namespace: 'admin', limit: 10, windowSec: 60 },
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.service).toBe(fakeService);
      expect(res.data.user).toEqual(FAKE_USER);
    }
    expect(mocks.mockRateLimit).toHaveBeenCalled();
    expect(mocks.mockIsUserMaintainer).toHaveBeenCalledWith(FAKE_USER.id);
  });
});

describe('requireMaintainerAuth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.mockGetServerSupabase.mockResolvedValue({
      auth: { getUser: mocks.mockGetUser },
    });
    mocks.mockGetUser.mockResolvedValue({ data: { user: FAKE_USER } });
  });

  it('delegates to requireMaintainer with no args', async () => {
    mocks.mockIsUserMaintainer.mockResolvedValue(true);

    const res = await requireMaintainerAuth();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.user).toEqual(FAKE_USER);
    }
  });

  it('returns not_authorised for non-maintainers', async () => {
    mocks.mockIsUserMaintainer.mockResolvedValue(false);

    const res = await requireMaintainerAuth();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('not_authorised');
  });
});
