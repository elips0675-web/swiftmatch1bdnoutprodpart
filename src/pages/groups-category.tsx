
import { Suspense, useState, useMemo } from 'react';
import { useParams, useRouter } from "@/shims/next-navigation";
import Link from "@/shims/next-link";
import {
    ChevronLeft,
    ChevronRight,
    Users,
    Plus,
    Gift,
    Play,
    CreditCard
} from 'lucide-react';
import { GROUP_CATEGORIES } from '@/lib/demo-data';
import { AppHeader } from '@/components/layout/app-header';
import { BottomNav } from '@/components/navigation/bottom-nav';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/context/language-context';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { CategoryFeed } from "@/components/feeds/category-feed";

const ITEMS_PER_PAGE = 10;

function Pagination({ current, total, onChange }: { current: number, total: number, onChange: (p: number) => void }) {
  if (total <= 1) return null;

  const pages = [];
  for (let i = 1; i <= total; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-1.5 mt-8 mb-4">
      <Button
        variant="outline"
        size="icon"
        className="w-8 h-8 rounded-lg border-muted bg-white"
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
      >
        <ChevronLeft size={14} />
      </Button>

      {pages.map(p => (
        <Button
          key={p}
          variant={current === p ? "default" : "outline"}
          size="icon"
          className={cn(
            "w-8 h-8 rounded-lg text-xs font-black transition-all",
            current === p ? "gradient-bg border-0 text-white shadow-md scale-110" : "bg-white border-muted text-muted-foreground hover:bg-muted/50"
          )}
          onClick={() => onChange(p)}
        >
          {p}
        </Button>
      ))}

      <Button
        variant="outline"
        size="icon"
        className="w-8 h-8 rounded-lg border-muted bg-white"
        disabled={current === total}
        onClick={() => onChange(current + 1)}
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}

function SubGroupsContent() {
    const params = useParams();
    const router = useRouter();
    const { t, language } = useLanguage();
    const categoryId = params?.category as string;

    const [showPremiumDialog, setShowPremiumDialog] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [viewMode, setViewMode] = useState<'feed' | 'list'>('list');

    const category = useMemo(() => GROUP_CATEGORIES.find(c => c.id === categoryId), [categoryId]);

    const totalPages = useMemo(() => {
        if (!category) return 0;
        return Math.ceil(category.subgroups.length / ITEMS_PER_PAGE);
    }, [category]);

    const paginatedSubgroups = useMemo(() => {
        if (!category) return [];
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        return category.subgroups.slice(start, start + ITEMS_PER_PAGE);
    }, [category, currentPage]);

    const handleAdWatch = () => {
        toast({ title: t('groups.ad.toast.title'), description: t('groups.ad.toast.description') });
        setShowPremiumDialog(false);
    };

    if (!category) {
        return (
          <div className="flex-1 flex items-center justify-center text-center p-8 bg-[#f8f9fb]">
            <div>
              <h2 className="text-xl font-bold">{t('groups.category_not_found')}</h2>
              <Button onClick={() => router.push('/groups')} className="mt-4 rounded-xl">{t('groups.back_to_groups')}</Button>
            </div>
          </div>
        );
    }

    const categoryNameRu = category.name_ru;
    const categoryNameEn = category.name_en;

    return (
        <div className="flex flex-col h-screen bg-[#f8f9fb]">
            <header className="flex items-center gap-2 px-3 py-2 border-b border-border sticky top-0 bg-white/90 backdrop-blur-lg z-50 h-16">
                <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full hover:bg-muted/50">
                    <ChevronLeft size={24} className="text-foreground" />
                </Button>
                <div className="flex-1 min-w-0 text-center">
                    <h3 className="font-black text-lg leading-tight tracking-tight text-foreground truncate">
                        {language === 'RU' ? categoryNameRu : categoryNameEn}
                    </h3>
                </div>
                <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                    <button
                        onClick={() => setViewMode('feed')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all",
                            viewMode === 'feed' ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {t('groups.tab.feed')}
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        className={cn(
                            "px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all",
                            viewMode === 'list' ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        {t('groups.tab.groups')}
                    </button>
                </div>
            </header>
            <main className="flex-1 overflow-y-auto">
                {viewMode === 'feed' ? (
                    <CategoryFeed categoryNameRu={categoryNameRu} categoryNameEn={categoryNameEn} />
                ) : (
                    <div className="px-5 pt-6 pb-24">
                        {/* Promo Banner */}
                        <div
                            onClick={() => setShowPremiumDialog(true)}
                            className="mb-6 bg-gradient-to-r from-blue-500 to-teal-500 p-4 rounded-xl text-white flex items-center gap-4 cursor-pointer hover:scale-[1.01] transition-transform app-shadow"
                        >
                            <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm border border-white/20">
                                <Gift size={24} />
                            </div>
                            <div>
                                <h4 className="font-black tracking-tight">{t('groups.ad.title')}</h4>
                                <p className="text-xs text-white/80 mt-0.5">{t('groups.ad.description')}</p>
                            </div>
                        </div>

                        {/* Subgroups List */}
                        <div className="space-y-3">
                            {paginatedSubgroups.map((subgroup: { id: number; name_ru: string; name_en: string; members: number; online?: number }) => (
                                <Link href={`/chats?groupId=${subgroup.id}`} key={subgroup.id} className="flex items-center justify-between p-4 bg-white rounded-xl app-shadow hover:bg-muted/30 transition-all cursor-pointer group border border-white">
                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-bold text-sm text-foreground truncate group-hover:text-primary transition-colors">
                                              {language === 'RU' ? subgroup.name_ru : subgroup.name_en}
                                            </h4>
                                            <div className="flex items-center text-muted-foreground text-[10px] mt-1.5 gap-3">
                                                <div className="flex items-center gap-1 font-bold uppercase tracking-wider">
                                                    <Users size={12} className="text-muted-foreground/60" /> {subgroup.members}
                                                </div>
                                                <div className="flex items-center gap-1 font-bold uppercase tracking-wider text-green-600">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-current"></div>
                                                    {subgroup.online} {t('chats.online')}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <Button variant="outline" className="ml-4 shrink-0 px-4 h-9 rounded-full border-primary/20 text-primary hover:bg-primary/5 hover:text-primary font-black uppercase text-[9px] tracking-widest transition-transform group-hover:scale-105">
                                        <Plus size={14} className="mr-1.5" />
                                        {t('button.join')}
                                    </Button>
                                </Link>
                            ))}
                        </div>

                        {/* Pagination */}
                        <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} />
                    </div>
                )}
            </main>
            <BottomNav />

            {/* Ad Watch Dialog */}
            <AnimatePresence>
                {showPremiumDialog && (
                <Dialog open={showPremiumDialog} onOpenChange={setShowPremiumDialog}>
                    <DialogContent aria-describedby={undefined} className="max-w-[340px] rounded-2xl p-0 overflow-hidden border-0 bg-white app-shadow">
                    <div className="relative h-40 bg-gradient-to-r from-blue-500 to-teal-500 flex flex-col items-center justify-center text-white p-6 overflow-hidden">
                        <div className="absolute inset-0 bg-black/5"></div>
                        <motion.div animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1] }} transition={{ duration: 2, repeat: Infinity }} className="absolute"><Gift size={160} /></motion.div>
                        <Gift className="text-white mb-2 drop-shadow-lg relative z-10 animate-pulse" size={48} />
                        <DialogTitle className="text-2xl font-black uppercase tracking-tighter relative z-10">{t('groups.ad.title')}</DialogTitle>
                    </div>
                    <div className="p-6 space-y-4">
                        <Button onClick={handleAdWatch} variant="outline" className="w-full h-16 rounded-xl border-2 border-primary/20 bg-primary/5 flex flex-col items-center justify-center gap-1 group hover:bg-primary/10 transition-all border-dashed">
                            <div className="flex items-center gap-2 text-primary"><Play size={14} fill="currentColor" /><span className="text-[11px] font-black uppercase tracking-widest">{t('autosearch.free')}</span></div>
                            <span className="text-[8px] text-muted-foreground font-bold uppercase tracking-tighter opacity-60">{t('groups.ad.access')}</span>
                        </Button>
                        <div className="relative py-2"><div className="absolute inset-0 flex items-center"><span className="w-full border-t border-muted"></span></div><div className="relative flex justify-center text-[8px] uppercase font-black tracking-widest text-muted-foreground bg-white px-4">{t('common.or')}</div></div>
                        <Button onClick={() => setShowPremiumDialog(false)} className="w-full h-16 rounded-xl gradient-bg text-white shadow-xl shadow-primary/20 flex flex-col items-center justify-center gap-1 active:scale-95 transition-all border-0">
                            <div className="flex items-center gap-2">
                                <CreditCard size={16} />
                                <span className="text-xs font-black uppercase tracking-widest">{t('autosearch.paid')}</span>
                            </div>
                            <span className="text-[10px] text-white/80 font-bold uppercase tracking-tighter">{t('groups.ad.price')}</span>
                        </Button>
                    </div>
                    <DialogFooter className="p-6 pt-0"><Button variant="ghost" onClick={() => setShowPremiumDialog(false)} className="w-full text-muted-foreground text-[9px] font-black uppercase tracking-widest h-10">{t('button.not_now')}</Button></DialogFooter>
                    </DialogContent>
                </Dialog>
                )}
            </AnimatePresence>
        </div>
    )
}

function LoadingSkeleton() {
    return (
        <div className="flex flex-col h-screen bg-[#f8f9fb]">
            <header className="flex items-center gap-2 px-3 py-2 border-b border-border sticky top-0 bg-white/90 backdrop-blur-lg z-50 h-16">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-6 w-32 rounded-md" />
            </header>
            <main className="flex-1 overflow-y-auto px-5 pt-6 pb-24">
                <div className="space-y-3">
                    {Array.from({ length: 10 }).map((_, i) => (
                         <div key={i} className="flex items-center gap-4 p-3 bg-white rounded-xl app-shadow">
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-5 w-4/5 rounded-md" />
                                <Skeleton className="h-4 w-3/5 rounded-md" />
                            </div>
                        </div>
                    ))}
                </div>
            </main>
            <BottomNav />
        </div>
    )
}

export default function SubGroupsPage() {
    return (
        <Suspense fallback={<LoadingSkeleton />}>
            <SubGroupsContent />
        </Suspense>
    )
}
