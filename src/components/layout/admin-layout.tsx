import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { AdminSidebar } from '@/components/navigation/admin-sidebar';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/context/language-context';

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <Sidebar collapsible="icon" className="bg-[#0f172a] text-slate-300 border-r-0">
          <SidebarContent className="p-0 bg-[#0f172a]">
            <AdminSidebar />
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="bg-slate-50">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:px-6">
            <SidebarTrigger className="md:hidden" />
            <Link to="/admin" className="flex-1">
              <h1 className="font-black text-lg uppercase tracking-tight">{t('admin.panel')}</h1>
            </Link>
          </header>
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
