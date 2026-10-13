import { useState, useEffect } from "react";
import { getToken } from "@/lib/token";
import { useLanguage } from "@/context/language-context";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Video, Clock, Check, X } from "lucide-react";

interface VideoDate {
  id: number;
  partnerName: string;
  partnerAvatar: string;
  scheduledAt: string;
  duration: number;
  status: "pending" | "accepted" | "declined" | "cancelled" | "completed";
  initiatedBy: "me" | "them";
  message?: string;
}

export default function SchedulePage() {
  const { t } = useLanguage();
  const [dates, setDates] = useState<VideoDate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    fetch("/api/schedule", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => setDates(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      accepted: "bg-green-100 text-green-800",
      declined: "bg-red-100 text-red-800",
      cancelled: "bg-gray-100 text-gray-500",
      completed: "bg-blue-100 text-blue-800",
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status] || ""}`}>
        {t(`schedule.${status}`)}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <AppHeader />
      <main className="px-4 pb-24 pt-4 max-w-2xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : dates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Calendar size={48} className="mb-4 opacity-30" />
            <p>{t("schedule.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {dates.map((date) => (
              <Card key={date.id} className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center overflow-hidden">
                    {date.partnerAvatar ? (
                      <img src={date.partnerAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Video size={20} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{date.partnerName}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Clock size={12} />
                      {new Date(date.scheduledAt).toLocaleString()}
                    </p>
                  </div>
                  {statusBadge(date.status)}
                </div>
                {date.message && (
                  <p className="mt-2 text-xs text-muted-foreground bg-muted/30 p-2 rounded">
                    {date.message}
                  </p>
                )}
                {date.status === "pending" && date.initiatedBy === "them" && (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="default" className="gap-1">
                      <Check size={14} /> {t("schedule.accept")}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1">
                      <X size={14} /> {t("schedule.decline")}
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
