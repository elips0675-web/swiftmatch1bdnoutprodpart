import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const h = vi.hoisted(() => ({
  token: 'test-token' as string | null,
  clearToken: vi.fn(),
  supabase: null as unknown,
}));

vi.mock('@/lib/token', () => ({
  getToken: () => h.token,
  setToken: vi.fn(),
  clearToken: () => h.clearToken(),
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => h.supabase,
}));

import { AdminGuard } from '@/components/shared/admin-guard';
import { PartnerGuard } from '@/components/shared/partner-guard';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function LocationProbe() {
  return <div data-testid="login">login</div>;
}

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/login" element={<LocationProbe />} />
        <Route path="/partner/register" element={<div data-testid="partner-register">register</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  h.token = 'test-token';
  h.supabase = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminGuard', () => {
  it('renders nothing while the admin check is in flight', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { container } = renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    expect(container.textContent).toBe('');
  });

  it('renders children when /api/admin/me answers 200', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ id: 1 }));
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    expect(await screen.findByText('admin area')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith('/api/admin/me', { headers: { Authorization: 'Bearer test-token' } });
  });

  it('sends no Authorization header when there is no token', async () => {
    h.token = null;
    mockFetch.mockImplementation(() => jsonResponse({ id: 1 }));
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    await screen.findByText('admin area');
    expect(mockFetch).toHaveBeenCalledWith('/api/admin/me', { headers: {} });
  });

  it('clears the token and redirects to /login on 401', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'ADMIN_REQUIRED' }, 401));
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy());
    expect(h.clearToken).toHaveBeenCalled();
    expect(screen.queryByText('admin area')).toBeNull();
  });

  it('clears the token and redirects to /login on 403', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'ADMIN_REQUIRED' }, 403));
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy());
    expect(h.clearToken).toHaveBeenCalled();
  });

  it('keeps an admin in on a server error (5xx) — documented fail-open', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'boom' }, 500));
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    expect(await screen.findByText('admin area')).toBeTruthy();
    expect(h.clearToken).not.toHaveBeenCalled();
  });

  it('keeps an admin in when the network is unavailable — documented fail-open', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    expect(await screen.findByText('admin area')).toBeTruthy();
  });

  it('keeps an admin in on a 404 from the check — documented fail-open', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'nope' }, 404));
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    expect(await screen.findByText('admin area')).toBeTruthy();
    expect(h.clearToken).not.toHaveBeenCalled();
  });

  it('authorizes via dev-login after a 401 outside prod', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/me') return jsonResponse({ message: 'ADMIN_REQUIRED' }, 401);
      return jsonResponse({ token: 'dev-token' }, 200);
    });
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    expect(await screen.findByText('admin area')).toBeTruthy();
    expect(h.clearToken).toHaveBeenCalled();
  });

  it('authorizes through Supabase when the profile role is admin', async () => {
    h.supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { role: 'admin' } }) }) }),
      })),
    };
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    expect(await screen.findByText('admin area')).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('redirects to /login through Supabase when the profile is not admin', async () => {
    h.supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { role: 'user' } }) }) }),
      })),
    };
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('admin area')).toBeNull();
  });

  it('redirects to /login through Supabase when there is no authenticated user', async () => {
    h.supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    };
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy());
    expect(screen.queryByText('admin area')).toBeNull();
  });

  it('redirects to /login through Supabase when the auth lookup throws', async () => {
    h.supabase = {
      auth: { getUser: vi.fn().mockRejectedValue(new Error('supabase down')) },
      from: vi.fn(),
    };
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy());
    expect(screen.queryByText('admin area')).toBeNull();
  });

  it('redirects to /login after a 401 when dev-login is unavailable', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/admin/me') return jsonResponse({ message: 'ADMIN_REQUIRED' }, 401);
      return jsonResponse({ message: 'dev login disabled' }, 404);
    });
    renderAt('/admin', <AdminGuard><div>admin area</div></AdminGuard>);
    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy());
    expect(screen.queryByText('admin area')).toBeNull();
  });
});

describe('PartnerGuard', () => {
  it('redirects to /login without a token and does not call the API', async () => {
    h.token = null;
    renderAt('/partner/dashboard', <PartnerGuard><div>partner area</div></PartnerGuard>);
    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('renders children when the dashboard answers 200', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ stats: {} }));
    renderAt('/partner/dashboard', <PartnerGuard><div>partner area</div></PartnerGuard>);
    expect(await screen.findByText('partner area')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith('/api/partner/dashboard', { headers: { Authorization: 'Bearer test-token' } });
  });

  it('redirects to /partner/register on 403 (authenticated but not a partner)', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'Not a partner account' }, 403));
    renderAt('/partner/dashboard', <PartnerGuard><div>partner area</div></PartnerGuard>);
    await waitFor(() => expect(screen.getByTestId('partner-register')).toBeTruthy());
    expect(screen.queryByText('partner area')).toBeNull();
  });

  it('clears the token and redirects to /login on 401 (invalid or expired token)', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'Invalid or expired token' }, 401));
    renderAt('/partner/dashboard', <PartnerGuard><div>partner area</div></PartnerGuard>);
    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy());
    expect(h.clearToken).toHaveBeenCalled();
    expect(screen.queryByText('partner area')).toBeNull();
  });

  it('keeps the partner in on a server error (5xx) — documented fail-open', async () => {
    mockFetch.mockImplementation(() => jsonResponse({ message: 'boom' }, 500));
    renderAt('/partner/dashboard', <PartnerGuard><div>partner area</div></PartnerGuard>);
    expect(await screen.findByText('partner area')).toBeTruthy();
    expect(h.clearToken).not.toHaveBeenCalled();
  });

  it('keeps the partner in when the network is unavailable — documented fail-open', async () => {
    mockFetch.mockImplementation(() => Promise.reject(new Error('network down')));
    renderAt('/partner/dashboard', <PartnerGuard><div>partner area</div></PartnerGuard>);
    expect(await screen.findByText('partner area')).toBeTruthy();
  });
});
