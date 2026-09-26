import { useSearchParams, useRouter } from "@/shims/next-navigation";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { CheckCircle } from "lucide-react";

export default function PremiumSuccess() {
  const { t } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params?.get('session_id');

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-green-50 to-white">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={40} className="text-green-500" />
        </div>
        <h1 className="text-2xl font-black tracking-tight mb-2">{t('premium.success_title')}</h1>
        <p className="text-muted-foreground text-sm mb-8">
          {t('premium.success_desc')}
        </p>
        <Button data-testid="back-home-button" onClick={() => router.push('/')} className="w-full h-12 rounded-full gradient-bg text-white font-black">
          {t('premium.back_home')}
        </Button>
      </div>
    </div>
  );
}
