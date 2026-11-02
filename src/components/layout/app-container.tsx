import { usePathname } from "@/shims/next-navigation";
import { cn } from '@/lib/utils';

export function AppContainer({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/');

    return (
        <div className={cn(
            'min-h-screen relative flex flex-col',
            isAdminPage 
                ? 'bg-muted/40' 
                : 'mx-auto max-w-[480px] bg-white shadow-2xl overflow-x-hidden'
        )}>
            {children}
        </div>
    );
}
