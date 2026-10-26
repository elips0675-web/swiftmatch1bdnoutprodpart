
import { useRouter } from "@/shims/next-navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import Image from "@/shims/next-image";
import dynamic from "@/shims/next-dynamic";
import { motion } from "framer-motion";

const HeartConfetti = dynamic(() => import("@/components/animations/heart-confetti").then(mod => mod.HeartConfetti), { ssr: false });

const DEFAULT_AVATAR = '/default-avatar.svg';

export function MatchDialog({
  open,
  onOpenChange,
  currentUser,
  matchUser,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: any;
  matchUser: any;
}) {
  const { t } = useLanguage();
  const router = useRouter();

  if (!matchUser) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] rounded-2xl border-0 p-0 overflow-hidden bg-white app-shadow">
        <div className="relative">
          {open && <HeartConfetti />}
          <div className="relative h-56 flex items-center justify-center p-6 gradient-bg overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
            <div className="flex items-center justify-center gap-0 relative">
              <motion.div initial={{ x: -60, opacity: 0, rotate: -15, scale: 0.8 }} animate={{ x: 0, opacity: 1, rotate: -8, scale: 1 }} transition={{ type: "spring", damping: 12, delay: 0.2 }} className="w-36 h-36 rounded-2xl border-4 border-white shadow-2xl overflow-hidden relative z-10 -mr-8 bg-muted">
                <Image src={currentUser?.photoURL || currentUser?.img || DEFAULT_AVATAR} alt={t('chats.you')} fill sizes="144px" className="object-cover" />
              </motion.div>
              <motion.div initial={{ x: 60, opacity: 0, rotate: 15, scale: 0.8 }} animate={{ x: 0, opacity: 1, rotate: 8, scale: 1 }} transition={{ type: "spring", damping: 12, delay: 0.3 }} className="w-36 h-36 rounded-2xl border-4 border-white shadow-2xl overflow-hidden relative z-0 bg-muted">
                <Image src={matchUser.img || DEFAULT_AVATAR} alt={matchUser.name || t('chats.unknown_user')} fill sizes="144px" className="object-cover" />
              </motion.div>
            </div>
          </div>
          <div className="px-8 pt-8 pb-8 text-center">
            <DialogTitle className="text-3xl font-black font-headline mb-3 gradient-text uppercase tracking-tight">{t('match.title')}</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm mb-8 px-6 leading-relaxed font-medium">
              {t('match.you_and')} <span className="font-bold text-foreground">{matchUser.name || t('chats.unknown_user')}</span> {t('match.liked_each_other')}
            </DialogDescription>
            
            <div className="flex flex-col gap-4 w-full mt-8">
              <Button disabled={!matchUser.id} onClick={() => router.push(`/chats?matchId=${matchUser.id}`)} className="w-full h-16 rounded-xl gradient-bg text-white font-black app-shadow hover:scale-[1.02] active:scale-95 transition-all border-0 uppercase tracking-[0.2em] text-[11px] shadow-primary/30">
                {t('button.write_first')}
              </Button>
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="w-full rounded-xl h-12 text-muted-foreground font-black hover:bg-muted transition-all uppercase tracking-[0.1em] text-[10px]">
                {t('button.continue')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
