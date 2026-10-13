import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Plus, Trash2, Loader2, X, UserPlus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { getToken } from "@/lib/token";
import { useLanguage } from "@/context/language-context";

interface Team {
  id: number;
  name: string;
  isActive: number | boolean;
  memberCount: number;
}

interface Member {
  id: number;
  name: string;
  email: string;
}

interface AdminUser {
  id: number;
  name: string;
  email: string;
}

function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (init?.body) headers['Content-Type'] = 'application/json';
  return fetch(url, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } })
    .then(r => { if (!r.ok) throw new Error('fetch failed'); return r.json(); });
}

function TeamCard({ team, members, isSuperAdmin, myId, onChanged }: {
  team: Team;
  members: Member[];
  isSuperAdmin: boolean;
  myId: number | null;
  onChanged: () => void;
}) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const data = await apiFetch<{ users: AdminUser[] }>(`/api/admin/users?search=${encodeURIComponent(q)}&page=1`);
        setResults(data.users ?? []);
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, isSuperAdmin]);

  const addMember = async (userId: number) => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/teams/${team.id}/members`, { method: 'POST', body: JSON.stringify({ userId }) });
      toast.success(t('admin.teams.member_added'));
      setQuery(''); setResults([]);
      onChanged();
    } catch {
      toast.error(t('admin.error.operation'));
    } finally { setBusy(false); }
  };

  const removeMember = async (userId: number) => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/teams/${team.id}/members/${userId}`, { method: 'DELETE' });
      toast.success(t('admin.teams.member_removed'));
      onChanged();
    } catch {
      toast.error(t('admin.error.operation'));
    } finally { setBusy(false); }
  };

  const toggleActive = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/teams/${team.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !(team.isActive === 1 || team.isActive === true) }) });
      toast.success(t('admin.teams.saved'));
      onChanged();
    } catch {
      toast.error(t('admin.error.save'));
    } finally { setBusy(false); }
  };

  const removeTeam = async () => {
    if (!window.confirm(t('admin.teams.confirm_delete'))) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/teams/${team.id}`, { method: 'DELETE' });
      toast.success(t('admin.teams.deleted'));
      onChanged();
    } catch {
      toast.error(t('admin.error.operation'));
    } finally { setBusy(false); }
  };

  const active = team.isActive === 1 || team.isActive === true;
  const memberIds = new Set(members.map(m => m.id));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base font-black flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" /> {team.name}
          <Badge variant="outline" className={`text-[9px] ${active ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-gray-100 text-gray-600'}`}>
            {active ? t('admin.teams.active') : t('admin.teams.inactive')}
          </Badge>
          <span className="text-xs font-normal text-muted-foreground">{t('admin.teams.member_count')}: {members.length}</span>
        </CardTitle>
        {isSuperAdmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-xl h-8" disabled={busy} onClick={toggleActive}>
              {active ? t('admin.teams.inactive') : t('admin.teams.active')}
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl h-8 text-destructive" disabled={busy} onClick={removeTeam}>
              <Trash2 size={14} />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {members.length === 0 && <p className="text-xs text-muted-foreground">{t('admin.teams.no_members')}</p>}
        <div className="flex flex-wrap gap-2">
          {members.map(m => (
            <span key={m.id} className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
              <span className="font-bold">{m.name || m.email}</span>
              <span className="text-muted-foreground">{m.email}</span>
              {(isSuperAdmin || m.id === myId) && (
                <button className="ml-1 text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => removeMember(m.id)} aria-label={t('admin.teams.remove')}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>

        {isSuperAdmin && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('admin.teams.search_placeholder')}
                className="h-9 rounded-xl text-xs"
              />
              <UserPlus size={16} className="text-muted-foreground shrink-0" />
            </div>
            {results.length > 0 && (
              <div className="rounded-xl border divide-y">
                {results.map(u => {
                  const already = memberIds.has(u.id);
                  return (
                    <div key={u.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <span><span className="font-bold">{u.name || u.email}</span> <span className="text-muted-foreground">{u.email}</span></span>
                      <Button size="sm" variant="outline" className="rounded-lg h-7 text-[11px]" disabled={busy || already} onClick={() => addMember(u.id)}>
                        {already ? t('admin.teams.active') : <><Plus size={12} className="mr-1" /> {t('admin.teams.add_member')}</>}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminTeamsPage() {
  const { t } = useLanguage();
  const [teams, setTeams] = useState<Team[]>([]);
  const [membersByTeam, setMembersByTeam] = useState<Record<number, Member[]>>({});
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [myId, setMyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [teamList, me] = await Promise.all([
        apiFetch<Team[]>('/api/admin/teams'),
        apiFetch<{ id?: number; teams?: number[] }>('/api/admin/me'),
      ]);
      setTeams(teamList);
      setIsSuperAdmin(Array.isArray(me.teams) && me.teams.length === 0);
      setMyId(typeof me.id === 'number' ? me.id : null);
      const memberLists = await Promise.all(
        teamList.map(team => apiFetch<Member[]>(`/api/admin/teams/${team.id}/members`).catch(() => [] as Member[])),
      );
      const map: Record<number, Member[]> = {};
      teamList.forEach((team, i) => { map[team.id] = memberLists[i]; });
      setMembersByTeam(map);
    } catch {
      toast.error(t('admin.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const createTeam = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await apiFetch('/api/admin/teams', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
      toast.success(t('admin.teams.created'));
      setName('');
      load();
    } catch {
      toast.error(t('admin.error.save'));
    } finally { setBusy(false); }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-black">{t('admin.teams.title')}</h1>
      </div>

      {!isSuperAdmin && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <ShieldAlert size={16} /> {t('admin.teams.super_only')}
        </div>
      )}

      {isSuperAdmin && (
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-2 pt-6">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('admin.teams.name_placeholder')}
              className="h-9 rounded-xl text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') createTeam(); }}
            />
            <Button className="rounded-xl h-9" disabled={busy || !name.trim()} onClick={createTeam}>
              <Plus size={14} className="mr-1" /> {t('admin.teams.create')}
            </Button>
          </CardContent>
        </Card>
      )}

      {teams.length === 0 && <p className="text-sm text-muted-foreground">{t('admin.teams.empty')}</p>}

      <div className="grid gap-4">
        {teams.map(team => (
          <TeamCard
            key={team.id}
            team={team}
            members={membersByTeam[team.id] ?? []}
            isSuperAdmin={isSuperAdmin}
            myId={myId}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}
