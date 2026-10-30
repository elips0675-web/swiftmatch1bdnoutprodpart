
import { memo } from "react";
import Link from "@/shims/next-link";
import { Trophy, MapPin, User, Heart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Image from "@/shims/next-image";

export type TopUser = {
  id: number;
  name: string;
  age: number;
  img: string;
  distance: number;
  match: number;
};

const FeaturedCard = memo(({ user, onLike, priority = false }: { user: TopUser; onLike: () => void; priority?: boolean }) => {
    return (
      <div className="bg-white rounded-xl overflow-hidden app-shadow group border border-transparent hover:border-primary/10 flex flex-col h-full transition-all relative">
        <Link href={`/user?id=${user.id}`} prefetch={true} className="relative aspect-[4/3] bg-muted block overflow-hidden cursor-pointer">
          <Image 
            src={user.img} 
            alt={user.name} 
            fill 
            sizes="(max-width: 480px) 45vw, 240px"
            priority={priority} // Performance: Priority for LCP on top cards
            className="object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div className="absolute top-1.5 right-1.5">
               <Badge className="bg-orange-500 text-white text-[8px] border-0 px-1.5 py-0.5 font-black uppercase shadow-lg">
                 {user.match}%
               </Badge>
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-white font-bold text-[11px] leading-tight truncate tracking-tight">{user.name}, {user.age}</p>
            <div className="text-white/80 text-[8px] flex items-center gap-1 font-bold mt-0.5">
              <MapPin size={8} /> {user.distance} км
            </div>
          </div>
        </Link>
        <div className="p-2 mt-auto">
          <div className="grid grid-cols-2 gap-1.5">
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 rounded-lg border-muted text-primary hover:bg-muted active:scale-95 transition-all group/heart shadow-sm"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onLike(); }}
            >
              <Heart size={14} className="group-hover/heart:fill-current" />
            </Button>
            <Button 
              asChild
              variant="outline" 
              size="sm" 
              className="h-8 rounded-lg border-muted bg-muted/30 text-foreground hover:bg-muted/50 active:scale-95 transition-all shadow-sm"
            >
              <Link href={`/user?id=${user.id}`} prefetch={true}>
                <User size={14} />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  });
FeaturedCard.displayName = "FeaturedCard";


export function TopOfWeekSection({ topUsers, onLike, t }: { topUsers: TopUser[], onLike: (user: TopUser) => void, t: (key: string) => string }) {
    return (
        <section className="px-5">
            <div className="grid grid-cols-2 gap-4">
                {topUsers.map((u, i) => (
                    <FeaturedCard key={u.id} user={u} onLike={() => onLike(u)} priority={i < 2} />
                ))}
            </div>
        </section>
    );
}
