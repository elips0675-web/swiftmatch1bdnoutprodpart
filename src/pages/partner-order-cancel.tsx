import { useRouter } from "@/shims/next-navigation";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { XCircle } from "lucide-react";

export default function PartnerOrderCancel() {
  const { t } = useLanguage();
  const router = useRouter();

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-orange-50 to-white">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 rounded-full bg-orange-100 flex items-center justify-center mx-auto mb-6">
          <XCircle size={40} className="text-orange-400" />
        </div>
        <h1 className="text-2xl font-black tracking-tight mb-2">{t("partner.order.cancel_title")}</h1>
        <p className="text-muted-foreground text-sm mb-8">
          {t("partner.order.cancel_desc")}
        </p>
        <Button
          data-testid="back-home-button"
          onClick={() => router.push("/")}
          className="w-full h-12 rounded-full gradient-bg text-white font-black"
        >
          {t("premium.back_home")}
        </Button>
      </div>
    </div>
  );
}
