import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Search, MoveHorizontal as MoreHorizontal, Download, ChevronLeft, ChevronRight, Ban, Trash2, TriangleAlert as AlertTriangle, UserCheck, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";
import { startImpersonation } from "@/lib/impersonation";

interface AdminUser {
  id: number;
  name: string;
  age: number;
  email: string;
  city: string;
  status: string;
  premium: string;
  online: boolean;
  joined: string;
  lastActive: string;
  bio: string;
  matchesCount?: number;
  reportsCount?: number;
}

interface UsersResponse {
  users: AdminUser[];
  total: number;
  cities: string[];
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  banned: 'bg-red-100 text-red-800 border-red-200',
  suspended: 'bg-amber-100 text-amber-800 border-amber-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
};
const PREMIUM_LABELS: Record<string, string> = { free: 'Free', plus: 'Plus', gold: 'Gold', platinum: 'Platinum' };
const PAGE_SIZE = 15;

export default function AdminUsersPage() {
  const { t } = useLanguage();
  const STATUS_LABELS: Record<string, string> = {
    active: t('admin.users.status.active'),
    banned: t('admin.users.status.banned'),
    suspended: t('admin.users.status.suspended'),
    pending: t('admin.users.status.pending'),
  };

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [cityFilter, setCityFilter] = useState<string>('all');
  const [premiumFilter, setPremiumFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'name' | 'joined' | 'age'>('joined');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drawerUser, setDrawerUser] = useState<AdminUser | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const params = new URLSearchParams({
        ...(search ? { search } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(cityFilter !== 'all' ? { city: cityFilter } : {}),
        ...(premiumFilter !== 'all' ? { premium: premiumFilter } : {}),
        sort: sortField,
        dir: sortDir,
        page: String(page),
      });
      const res = await fetch(`/api/admin/users?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data: UsersResponse = await res.json();
      setTotal(data.total);
      if (data.cities.length > 0) setCities(data.cities);
    } catch {
      toast.error(t('admin.error.load'));
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, cityFilter, premiumFilter, sortField, sortDir, page, t]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const fetchUserDetail = async (id: number) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/users/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data: AdminUser = await res.json();
      setDrawerUser(data);
    } catch {
      toast.error(t('admin.error.load'));
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const toggleSelect = (id: number) => setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  const toggleAll = () => {
    if (selected.size === users.length) setSelected(new Set());
    else setSelected(new Set(users.map(u => u.id)));
  };

  const bulkAction = useCallback(async (action: 'ban' | 'suspend' | 'delete') => {
    if (!selected.size) return;
    const labels = { ban: t('admin.users.bulk_banned'), suspend: t('admin.users.bulk_suspended'), delete: t('admin.users.bulk_deleted') };
    try {
      const token = getToken();
      const res = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ids: Array.from(selected), action }),
      });
      if (!res.ok) throw new Error('Bulk action failed');
      toast.success(`${selected.size} — ${labels[action]}`);
      setSelected(new Set());
      fetchUsers();
    } catch {
      toast.error(t('admin.error.operation'));
    }
  }, [selected, t, fetchUsers]);

  const handleBan = async (id: number, currentlyBanned: boolean) => {
    try {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      if (currentlyBanned) {
        await fetch(`/api/admin/users/${id}/unban`, { method: 'POST', headers });
        toast.success(t('admin.users.unbanned_toast'));
      } else {
        await fetch(`/api/admin/users/${id}/ban`, { method: 'POST', headers, body: JSON.stringify({ reason: 'Admin action' }) });
        toast.success(t('admin.users.banned_toast'));
      }
      fetchUsers();
    } catch { toast.error(t('admin.error.operation')); }
  };

  const handleDelete = async (id: number) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(t('admin.users.deleted_toast'));
      setDrawerUser(null);
      fetchUsers();
    } catch { toast.error(t('admin.error.operation')); }
  };

  const handleImpersonate = async (user: AdminUser) => {
    try {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const res = await fetch(`/api/admin/impersonate/${user.id}`, { method: 'POST', headers });
      if (!res.ok) { toast.error(t('admin.impersonate.error')); return; }
      const data = await res.json();
      if (!data?.token) { toast.error(t('admin.impersonate.error')); return; }
      startImpersonation(data.token, { id: user.id, name: user.name });
      window.location.href = '/';
    } catch { toast.error(t('admin.impersonate.error')); }
  };

  const handleExport = () => {
    const csvRows = users.map(u => ({
      ID: u.id, Name: u.name, Age: u.age, Email: u.email, City: u.city,
      Status: STATUS_LABELS[u.status] || u.status, Plan: u.premium, Joined: u.joined,
    }));
    if (!csvRows.length) return;
    const headers = Object.keys(csvRows[0]);
    const csv = [headers.join(','), ...csvRows.map(r => headers.map(h => `"${String(r[h as keyof typeof r] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'users_export.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(t('admin.users.csv_downloaded'));
  };

  const handleSearch = (val: string) => { setSearch(val); setPage(1); };
  const handleStatusFilter = (v: string) => { setStatusFilter(v); setPage(1); };
  const handleCityFilter = (v: string) => { setCityFilter(v); setPage(1); };
  const handlePremiumFilter = (v: string) => { setPremiumFilter(v); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input data-testid="search-users" placeholder={t('admin.users.search_placeholder')} value={search} onChange={e => handleSearch(e.target.value)} className="pl-9 h-10 rounded-xl" />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusFilter}>
          <SelectTrigger className="w-[150px] h-10 rounded-xl"><SelectValue placeholder={t('admin.users.status')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.users.all_statuses')}</SelectItem>
            <SelectItem value="active">{t('admin.users.status.active')}</SelectItem>
            <SelectItem value="banned">{t('admin.users.status.banned')}</SelectItem>
            <SelectItem value="suspended">{t('admin.users.status.suspended')}</SelectItem>
            <SelectItem value="pending">{t('admin.users.status.pending')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={cityFilter} onValueChange={handleCityFilter}>
          <SelectTrigger className="w-[160px] h-10 rounded-xl"><SelectValue placeholder={t('admin.users.city')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.users.all_cities')}</SelectItem>
            {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={premiumFilter} onValueChange={handlePremiumFilter}>
          <SelectTrigger className="w-[140px] h-10 rounded-xl"><SelectValue placeholder={t('admin.users.plan')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('admin.users.all_plans')}</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="plus">Plus</SelectItem>
            <SelectItem value="gold">Gold</SelectItem>
            <SelectItem value="platinum">Platinum</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport} className="rounded-xl h-10">
          <Download size={14} className="mr-2" /> CSV
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50 border">
          <span className="text-sm font-bold">{selected.size} {t('admin.users.selected')}</span>
          <Button size="sm" variant="outline" onClick={() => bulkAction('ban')} className="rounded-lg h-8 text-xs"><Ban size={12} className="mr-1" /> {t('admin.users.ban')}</Button>
          <Button size="sm" variant="outline" onClick={() => bulkAction('suspend')} className="rounded-lg h-8 text-xs"><AlertTriangle size={12} className="mr-1" /> {t('admin.users.suspend')}</Button>
          <Button size="sm" variant="destructive" onClick={() => bulkAction('delete')} className="rounded-lg h-8 text-xs"><Trash2 size={12} className="mr-1" /> {t('admin.users.delete')}</Button>
        </div>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><Checkbox checked={selected.size === users.length && users.length > 0} onCheckedChange={toggleAll} /></TableHead>
                <TableHead className="cursor-pointer select-none" onClick={() => toggleSort('name')}>{t('admin.users.name')} {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</TableHead>
                <TableHead className="hidden md:table-cell cursor-pointer select-none" onClick={() => toggleSort('age')}>{t('admin.users.age')} {sortField === 'age' && (sortDir === 'asc' ? '↑' : '↓')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('admin.users.email')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('admin.users.city')}</TableHead>
                <TableHead>{t('admin.users.status')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('admin.users.plan')}</TableHead>
                <TableHead className="hidden lg:table-cell cursor-pointer select-none" onClick={() => toggleSort('joined')}>{t('admin.users.joined')} {sortField === 'joined' && (sortDir === 'asc' ? '↑' : '↓')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : users.map(user => (
                <TableRow key={user.id} className="group">
                  <TableCell><Checkbox checked={selected.has(user.id)} onCheckedChange={() => toggleSelect(user.id)} /></TableCell>
                  <TableCell>
                    <button onClick={() => fetchUserDetail(user.id)} className="font-bold text-sm hover:text-primary transition-colors text-left">
                      {user.name}, {user.age}
                    </button>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{user.age}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{user.email}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs">{user.city}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[9px] ${STATUS_COLORS[user.status] || ''}`}>{STATUS_LABELS[user.status] || user.status}</Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" className={`text-[9px] ${user.premium !== 'free' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}`}>
                      {PREMIUM_LABELS[user.premium] || user.premium}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{user.joined}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-muted"><MoreHorizontal className="h-4 w-4" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="rounded-xl">
                        <DropdownMenuItem onClick={() => fetchUserDetail(user.id)}>{t('admin.users.view')}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleImpersonate(user)}>
                          <LogIn size={14} className="mr-2" /> {t('admin.users.impersonate')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleBan(user.id, user.status === 'banned')}>
                          {user.status === 'banned' ? t('admin.users.unblock') : t('admin.users.block')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(user.id)}>
                          {t('admin.users.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        <CardFooter className="flex items-center justify-between border-t p-4">
          <span className="text-xs text-muted-foreground">{t('admin.users.showing')} {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} {t('admin.users.of')} {total}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></Button>
            <span className="text-sm font-bold">{page} / {totalPages}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></Button>
          </div>
        </CardFooter>
      </Card>

      <Sheet open={!!drawerUser} onOpenChange={(open) => !open && setDrawerUser(null)}>
        <SheetContent className="overflow-y-auto">
          {drawerUser && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {drawerUser.name}, {drawerUser.age}
                  <Badge variant="outline" className={`text-[9px] ${STATUS_COLORS[drawerUser.status] || ''}`}>{STATUS_LABELS[drawerUser.status] || drawerUser.status}</Badge>
                </SheetTitle>
                <SheetDescription>{drawerUser.email}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-muted/50"><p className="text-[10px] font-bold text-muted-foreground uppercase">{t('admin.users.city')}</p><p className="font-bold text-sm">{drawerUser.city}</p></div>
                  <div className="p-3 rounded-xl bg-muted/50"><p className="text-[10px] font-bold text-muted-foreground uppercase">{t('admin.users.plan')}</p><p className="font-bold text-sm">{PREMIUM_LABELS[drawerUser.premium] || drawerUser.premium}</p></div>
                  <div className="p-3 rounded-xl bg-muted/50"><p className="text-[10px] font-bold text-muted-foreground uppercase">{t('admin.users.matches_count')}</p><p className="font-bold text-sm">{drawerUser.matchesCount ?? '—'}</p></div>
                  <div className="p-3 rounded-xl bg-muted/50"><p className="text-[10px] font-bold text-muted-foreground uppercase">{t('admin.users.reports_count')}</p><p className="font-bold text-sm">{drawerUser.reportsCount ?? '—'}</p></div>
                </div>
                <div className="p-3 rounded-xl bg-muted/50"><p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">{t('admin.users.bio')}</p><p className="text-sm">{drawerUser.bio || '—'}</p></div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase mb-2">{t('admin.users.reg_date')}: {drawerUser.joined}</p>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">{t('admin.users.last_active')}: {drawerUser.lastActive}</p>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" className="flex-1 rounded-xl" data-testid="impersonate-drawer" onClick={() => handleImpersonate(drawerUser)}>
                    <LogIn size={14} className="mr-1" /> {t('admin.users.impersonate')}
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 rounded-xl" onClick={() => handleBan(drawerUser.id, drawerUser.status === 'banned')}>
                    {drawerUser.status === 'banned' ? <><UserCheck size={14} className="mr-1" /> {t('admin.users.unblock')}</> : <><Ban size={14} className="mr-1" /> {t('admin.users.block')}</>}
                  </Button>
                  <Button size="sm" variant="destructive" className="rounded-xl" onClick={() => handleDelete(drawerUser.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
