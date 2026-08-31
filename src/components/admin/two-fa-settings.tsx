import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';
import QRCode from 'qrcode';

// TOTP 2FA enrollment (этап 38): секрет + otpauth URL для приложения-аутентификатора
export default function TwoFaSettings() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  useEffect(() => {
    if (setup?.otpauthUrl) {
      QRCode.toDataURL(setup.otpauthUrl, { width: 180, margin: 1 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
    } else {
      setQrDataUrl(null);
    }
  }, [setup]);

  const post = async (path: string, body: Record<string, unknown>) => {
    const token = getToken();
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };

  const startSetup = async () => {
    setBusy(true); setError(''); setOk('');
    try {
      const { status, data } = await post('/api/auth/2fa/setup', {});
      if (status !== 200) throw new Error(data.message || 'setup failed');
      setSetup(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enable2fa = async () => {
    setBusy(true); setError(''); setOk('');
    try {
      const { status, data } = await post('/api/auth/2fa/enable', { code });
      if (status !== 200) throw new Error(data.message || 'TOTP_INVALID');
      setEnabled(true);
      setSetup(null);
      setCode('');
      setOk(t('two_fa_enabled'));
    } catch (e) {
      setError((e as Error).message === 'TOTP_INVALID' ? t('two_fa_invalid_code') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disable2fa = async () => {
    setBusy(true); setError(''); setOk('');
    try {
      const { status, data } = await post('/api/auth/2fa/disable', { code });
      if (status !== 200) throw new Error(data.message || 'TOTP_INVALID');
      setEnabled(false);
      setCode('');
      setOk(t('two_fa_disabled'));
    } catch (e) {
      setError((e as Error).message === 'TOTP_INVALID' ? t('two_fa_invalid_code') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-500" />
          {t('two_fa_title')}
        </CardTitle>
        {enabled !== null && (
          <Badge variant={enabled ? 'default' : 'outline'}>{enabled ? 'ON' : 'OFF'}</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!setup && !enabled && (
          <>
            <p className="text-xs text-muted-foreground">{t('two_fa_hint')}</p>
            <Button size="sm" onClick={startSetup} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              {t('two_fa_setup')}
            </Button>
          </>
        )}

        {setup && (
          <div className="space-y-2 text-xs">
            {qrDataUrl ? (
              <>
                <p className="font-medium">{t('two_fa_scan_qr')}:</p>
                <img
                  src={qrDataUrl}
                  alt="TOTP QR"
                  className="h-[180px] w-[180px] rounded border bg-white p-1"
                  data-testid="two-fa-qr"
                />
              </>
            ) : (
              <p className="font-medium">{t('two_fa_scan_or_key')}:</p>
            )}
            <code className="block break-all rounded bg-muted p-2 text-[10px]">{setup.otpauthUrl}</code>
            <p className="text-muted-foreground">{t('two_fa_manual_key')}:</p>
            <code className="block break-all rounded bg-muted p-2 text-[10px] tracking-widest">{setup.secret}</code>
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder={t('two_fa_code_placeholder')}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={enable2fa} disabled={busy || code.length !== 6}>
                {t('two_fa_enable')}
              </Button>
            </div>
          </div>
        )}

        {enabled && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('two_fa_disable_hint')}</p>
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder={t('two_fa_code_placeholder')}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <Button size="sm" variant="destructive" onClick={disable2fa} disabled={busy || code.length !== 6}>
              {t('two_fa_disable')}
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        {ok && <p className="text-xs text-emerald-600">{ok}</p>}
      </CardContent>
    </Card>
  );
}
