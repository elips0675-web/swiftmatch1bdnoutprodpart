import { useEffect, useState } from "react";
import { useSearchParams } from "@/shims/next-navigation";
import { Sparkles, Check, XCircle, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";

type Status = "loading" | "success" | "invalid" | "disabled" | "error";

export default function UnsubscribePage() {
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const userId = searchParams.get("u") || "";
  const token = searchParams.get("t") || "";
  const [status, setStatus] = useState<Status>(userId && token ? "loading" : "invalid");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId || !token) return;
    const current = attempt;
    setStatus("loading");
    fetch("/api/email/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ u: userId, t: token }),
    })
      .then(async (res) => {
        if (current !== attempt) return;
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setStatus("success");
          return;
        }
        if (data.code === "UNSUBSCRIBE_DISABLED") {
          setStatus("disabled");
          return;
        }
        setStatus(data.code === "UNSUBSCRIBE_INVALID" ? "invalid" : "error");
      })
      .catch(() => {
        if (current === attempt) setStatus("error");
      });
  }, [userId, token, attempt]);

  const heading =
    status === "loading" ? t("unsubscribe.loading")
    : status === "success" ? t("unsubscribe.success")
    : status === "disabled" ? t("unsubscribe.disabled")
    : t("unsubscribe.error");

  const text =
    status === "loading" ? t("unsubscribe.description")
    : status === "success" ? t("unsubscribe.success_desc")
    : status === "invalid" ? t("unsubscribe.invalid_link")
    : t("unsubscribe.support_hint");

  const retry = () => setAttempt((n) => n + 1);

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="w-16 h-16 rounded-full gradient-bg flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary/30">
          {status === "loading" ? <Loader2 className="text-white animate-spin" size={28} />
            : status === "success" ? <Check className="text-white" size={28} />
            : <XCircle className="text-white" size={28} />}
        </div>
        <h1 className="text-2xl font-black tracking-tight">{heading}</h1>
        <p className="text-sm text-muted-foreground">{text}</p>
        {status === "error" && (
          <Button onClick={retry} className="w-full h-12 rounded-full gradient-bg text-white font-black uppercase tracking-wider">
            {t("unsubscribe.retry")}
          </Button>
        )}
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 flex items-center justify-center gap-1">
          <Sparkles size={12} className="inline" />
          <Mail size={12} className="inline" />
          SwiftMatch
        </p>
      </div>
    </div>
  );
}

