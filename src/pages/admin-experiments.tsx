import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { FlaskConical, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

interface Experiment {
  id: number;
  name: string;
  experiment_key: string;
  description: string | null;
  enabled: number;
  created_at: string;
  variant_a_count: number;
  variant_b_count: number;
}

export default function AdminExperimentsPage() {
  const { t } = useLanguage();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const load = useCallback(async () => {
    try {
      const token = getToken();
      const res = await fetch('/api/admin/experiments', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setExperiments(Array.isArray(data) ? data : []);
    } catch {
      toast.error(t('admin.experiments.load_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const toggleExperiment = async (exp: Experiment, enabled: boolean) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/experiments/${exp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      setExperiments(prev => prev.map(e => e.id === exp.id ? { ...e, enabled: enabled ? 1 : 0 } : e));
      toast.success(enabled ? t('admin.experiments.enabled') : t('admin.experiments.disabled'));
    } catch {
      toast.error(t('admin.error.operation'));
    }
  };

  const deleteExperiment = async (exp: Experiment) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/experiments/${exp.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to delete');
      setExperiments(prev => prev.filter(e => e.id !== exp.id));
      toast.success(t('admin.experiments.deleted'));
    } catch {
      toast.error(t('admin.error.operation'));
    }
  };

  const createExperiment = async () => {
    if (!newName.trim() || !newKey.trim()) return;
    setCreating(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: newName, experiment_key: newKey, description: newDescription }),
      });
      if (!res.ok) throw new Error('Failed to create');
      setNewName(''); setNewKey(''); setNewDescription('');
      toast.success(t('admin.experiments.created'));
      await load();
    } catch {
      toast.error(t('admin.error.operation'));
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            {t('admin.experiments.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {experiments.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">{t('admin.experiments.empty')}</p>
          )}
          {experiments.map(exp => {
            const total = exp.variant_a_count + exp.variant_b_count;
            const bPct = total > 0 ? Math.round((exp.variant_b_count / total) * 100) : 0;
            return (
              <div key={exp.id} className="flex items-center justify-between gap-4 p-4 rounded-2xl border bg-background hover:bg-muted/5 transition-colors">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold">{exp.name}</span>
                    <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{exp.experiment_key}</code>
                    {exp.enabled ? <Badge className="bg-emerald-500 text-white text-[9px]">{t('admin.experiments.active')}</Badge> : <Badge variant="outline" className="text-[9px]">{t('admin.experiments.paused')}</Badge>}
                  </div>
                  {exp.description && <p className="text-xs text-muted-foreground truncate">{exp.description}</p>}
                  <div className="text-[11px] font-bold text-muted-foreground">
                    A: {exp.variant_a_count} · B: {exp.variant_b_count} · {bPct}% B
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={!!exp.enabled} onCheckedChange={v => toggleExperiment(exp, v)} />
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => deleteExperiment(exp)}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-black flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            {t('admin.experiments.create')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input placeholder={t('admin.experiments.name_ph')} value={newName} onChange={e => setNewName(e.target.value)} />
            <Input placeholder={t('admin.experiments.key_ph')} value={newKey} onChange={e => setNewKey(e.target.value)} />
          </div>
          <Input placeholder={t('admin.experiments.desc_ph')} value={newDescription} onChange={e => setNewDescription(e.target.value)} />
          <div className="flex justify-end">
            <Button onClick={createExperiment} disabled={creating || !newName.trim() || !newKey.trim()} className="rounded-full bg-primary text-primary-foreground font-bold h-10 px-8">
              {creating ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Plus className="mr-2 h-3 w-3" />}
              {t('admin.experiments.create_btn')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}