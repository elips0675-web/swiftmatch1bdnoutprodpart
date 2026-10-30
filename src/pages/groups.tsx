import React, { useState, useEffect, useMemo, useRef } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/context/language-context";
import { GROUP_CATEGORIES, type DemoGroupCategory } from "@/lib/demo-data";
import Link from "@/shims/next-link";
import { Users, Search, Star, Music, Dumbbell, Palette, Gamepad2, Film, Globe, ChefHat, Cpu, BookOpen, Sparkles, Shirt, HeartPulse, Dog, FlaskConical, Briefcase, Chrome as HomeIcon, Car, Laugh, Scroll, CirclePlus as PlusCircle, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { containsForbiddenWords } from "@/lib/word-filter";

const iconMap: Record<string, React.ElementType> = {
  Music, Dumbbell, Palette, Gamepad2, Film, Globe, ChefHat, Cpu, BookOpen, Sparkles, Shirt, HeartPulse, Dog, FlaskConical, Briefcase, Home: HomeIcon, Car, Laugh, Star, Scroll
};

type GroupEntry = DemoGroupCategory & { onlineCount?: number };

const GroupCard = ({ group }: { group: GroupEntry }) => {
  const { t, language } = useLanguage();
  const Icon = iconMap[group.icon] || Users;
  return (
    <Link
      href={`/groups/${group.id}`}
      prefetch={true}
      className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:bg-primary/5 transition-all flex flex-col group"
    >
      <div className="h-24 w-full flex items-center justify-center border-b border-slate-200 bg-muted/20">
        <Icon size={32} className="text-primary group-hover:scale-110 transition-transform duration-300" />
      </div>
      <div className="p-4 text-center">
        <h4 className="font-black text-xs uppercase tracking-tight leading-tight truncate">{language === 'RU' ? group.name_ru : group.name_en}</h4>
        <p className="text-[10px] text-green-600 font-bold uppercase mt-2 flex items-center justify-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-current rounded-full"></span>
          {group.onlineCount || Math.floor(Math.random() * 50) + 10} {t('chats.online')}
        </p>
      </div>
    </Link>
  );
};

const GroupList = ({ groups, emptyMessage }: { groups: GroupEntry[], emptyMessage: string }) => {
  if (groups.length === 0) {
    return <p className="text-center text-muted-foreground mt-8 text-sm">{emptyMessage}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-4">
      {groups.map((group) => (
        <GroupCard key={group.id} group={group} />
      ))}
    </div>
  );
};

function Pagination({
  current,
  total,
  onChange,
}: {
  current: number;
  total: number;
  onChange: (p: number) => void;
}) {
  if (total <= 1) return null;

  const pages: number[] = [];
  for (let i = 1; i <= total; i++) pages.push(i);

  return (
    <div className="flex items-center justify-center gap-1.5 mt-6 mb-2">
      <Button
        variant="outline"
        size="icon"
        className="w-8 h-8 rounded-lg border-muted bg-white"
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
      >
        <span className="text-[12px] font-black">‹</span>
      </Button>

      {pages.map((p) => (
        <Button
          key={p}
          variant={current === p ? "default" : "outline"}
          size="icon"
          className={cn(
            "w-8 h-8 rounded-lg text-xs font-black transition-all",
            current === p
              ? "gradient-bg border-0 text-white shadow-md scale-110"
              : "bg-white border-muted text-muted-foreground hover:bg-muted/50"
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
        <span className="text-[12px] font-black">›</span>
      </Button>
    </div>
  );
}

export default function GroupsPage() {
  const { t, language } = useLanguage();
  const [isMounted, setIsMounted] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupCategory, setNewGroupCategory] = useState("");
  const mainRef = useRef<HTMLDivElement | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const [activeTab, setActiveTab] = useState<"find" | "top-week" | "my-groups">("find");
  const ITEMS_PER_PAGE = 12; // 2 колонки => 6 рядов
  const [currentPage, setCurrentPage] = useState(1);

  // Demo data for different tabs
  const myGroupIds = ['music', 'creativity', 'gaming'];
  const myGroups = GROUP_CATEGORIES.filter(g => myGroupIds.includes(g.id));
  const topGroups = GROUP_CATEGORIES.slice(2, 6);
  const popularGroups = GROUP_CATEGORIES;

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    const onScroll = () => {
      setShowScrollTop(el.scrollTop > 300);
    };

    el.addEventListener("scroll", onScroll);
    onScroll();

    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const handleCreateGroup = () => {
    if (!newGroupName.trim() || !newGroupCategory) {
      toast({
        variant: "destructive",
        title: t('groups.create.error_title'),
        description: t('groups.create.error_desc'),
      });
      return;
    }

    if (containsForbiddenWords(newGroupName) || containsForbiddenWords(newGroupDesc)) {
        toast({
          variant: "destructive",
          title: t('groups.create.forbidden_title'),
          description: t('groups.create.forbidden_desc'),
        });
        return;
    }

    toast({
      title: t('groups.create.success_title'),
      description: `${t('groups.create.success_desc_start')}${newGroupName}${t('groups.create.success_desc_end')}`,
    });

    setIsCreateOpen(false);
    setNewGroupName("");
    setNewGroupDesc("");
    setNewGroupCategory("");
  };

  if (!isMounted) {
    return (
      <div className="flex flex-col h-screen bg-[#f8f9fb]">
        <AppHeader />
        <main className="flex-1 p-6">
          <div className="px-5 pt-6">
            <Skeleton className="h-10 w-full mb-4" />
            <Skeleton className="h-12 w-full mb-6" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
              <Skeleton className="h-40 rounded-2xl" />
            </div>
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#f8f9fb]">
      <AppHeader />
      <main ref={mainRef} className="flex-1 overflow-y-auto pb-24">
        <div className="px-5 pt-6 flex justify-between items-center mb-4">
           <h1 className="text-3xl font-black font-headline tracking-tight">{t('nav.groups')}</h1>
           <Button data-testid="create-group-button" onClick={() => setIsCreateOpen(true)} className="gap-2 rounded-full shadow-lg shadow-primary/20 border-0 gradient-bg text-white font-bold h-10 px-5 active:scale-95 transition-all">
             <PlusCircle size={16} />
             <span className="text-xs uppercase tracking-widest font-black">{t('groups.create_button')}</span>
           </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
          <div className="px-5">
            <TabsList className="grid w-full grid-cols-3 bg-muted p-1 rounded-xl mb-6">
              <TabsTrigger value="find">{t('groups.tabs.find')}</TabsTrigger>
              <TabsTrigger value="top-week">{t('groups.tabs.top')}</TabsTrigger>
              <TabsTrigger value="my-groups">{t('groups.tabs.my')}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="find" className="px-5">
            {(() => {
              const totalPages = Math.ceil(popularGroups.length / ITEMS_PER_PAGE);
              const start = (currentPage - 1) * ITEMS_PER_PAGE;
              const groups = popularGroups.slice(start, start + ITEMS_PER_PAGE);

              return (
                <>
                  <GroupList groups={groups} emptyMessage={t('groups.not_found')}  />
                  <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} />
                </>
              );
            })()}
          </TabsContent>
          
          <TabsContent value="top-week" className="px-5">
            {(() => {
              const totalPages = Math.ceil(topGroups.length / ITEMS_PER_PAGE);
              const start = (currentPage - 1) * ITEMS_PER_PAGE;
              const groups = topGroups.slice(start, start + ITEMS_PER_PAGE);
              return (
                <>
                  <GroupList groups={groups} emptyMessage={t('groups.no_top_groups')}  />
                  <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} />
                </>
              );
            })()}
          </TabsContent>

          <TabsContent value="my-groups" className="px-5">
            {(() => {
              const totalPages = Math.ceil(myGroups.length / ITEMS_PER_PAGE);
              const start = (currentPage - 1) * ITEMS_PER_PAGE;
              const groups = myGroups.slice(start, start + ITEMS_PER_PAGE);
              return (
                <>
                  <GroupList groups={groups} emptyMessage={t('groups.not_joined')}  />
                  <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} />
                </>
              );
            })()}
          </TabsContent>

        </Tabs>
      </main>

      {showScrollTop && (
        <Button
          onClick={() => {
            mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="fixed bottom-24 right-5 z-[60] w-12 h-12 rounded-full shadow-xl"
          size="icon"
          variant="default"
        >
          <ChevronUp size={20} />
        </Button>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md rounded-3xl p-0 border-0 app-shadow">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="font-black tracking-tight text-xl">{t('groups.create.title')}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground font-medium">
              {t('groups.create.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-6">
            <div className="space-y-2">
              <Label htmlFor="name" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">{t('groups.create.name_label')}</Label>
              <Input data-testid="group-name" id="name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="h-12 rounded-xl bg-muted/50 border-0" placeholder={t('groups.create.name_placeholder')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">{t('groups.create.desc_label')}</Label>
              <Textarea data-testid="group-description" id="description" value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)} className="rounded-xl bg-muted/50 border-0" placeholder={t('groups.create.desc_placeholder')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">{t('groups.create.category_label')}</Label>
              <Select value={newGroupCategory} onValueChange={setNewGroupCategory}>
                <SelectTrigger className="h-12 rounded-xl bg-muted/50 border-0">
                  <SelectValue placeholder={t('groups.create.category_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id.toString()}>
                      {language === 'RU' ? cat.name_ru : cat.name_en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="p-6 flex-col sm:flex-col sm:space-x-0 gap-3">
            <Button data-testid="submit-create-group" onClick={handleCreateGroup} className="w-full h-12 rounded-xl gradient-bg text-white font-black uppercase tracking-widest shadow-lg shadow-primary/20 border-0">{t('groups.create.submit')}</Button>
            <Button variant="ghost" className="w-full h-10 rounded-xl font-black uppercase text-xs tracking-widest" onClick={() => setIsCreateOpen(false)}>{t('button.cancel')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}