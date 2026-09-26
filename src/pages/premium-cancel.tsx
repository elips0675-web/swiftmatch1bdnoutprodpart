import { useRouter } from "@/shims/next-navigation";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { XCircle } from "lucide-react";

export default function PremiumCancel() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-orange-50 to-white">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-6">
          <XCircle size={40} className="text-orange-500" />
        </div>
        <h1 className="text-2xl font-black tracking-tight mb-2">{t('premium.cancel_title')}</h1>
        <p className="text-muted-foreground text-sm mb-8">
          {t('premium.cancel_desc')}
        </p>
        <div className="flex flex-col gap-3">
          <Button onClick={() => router.push('/')} className="w-full h-12 rounded-full gradient-bg text-white font-black">
            {t('premium.back_home')}
          </Button>
          <Button onClick={() => router.back()} variant="outline" className="w-full h-12 rounded-full font-black">
            {t('premium.try_again')}
          </Button>
        </div>
      </div>
    </div>
  );
}
