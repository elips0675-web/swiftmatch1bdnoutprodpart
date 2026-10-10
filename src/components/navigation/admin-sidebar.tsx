import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
  useSidebar,
} from '@/components/ui/sidebar';
import { LayoutDashboard, Users, Flag, Chrome as Home, Shield, LogOut, ChevronsLeft, ChevronsRight, SlidersHorizontal, DollarSign, Package, Mail, Image, ChartBar as BarChart3, Languages, Check, FlaskConical, CalendarDays, Handshake, DatabaseBackup, Webhook } from 'lucide-react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useLanguage } from '@/context/language-context';

export function AdminSidebar() {
  const { pathname } = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const { language, setLanguage, t } = useLanguage();
  const collapsed = state === 'collapsed';

  const NAV_ITEMS = [
    { title: t('admin.dashboard'), path: '/admin', icon: LayoutDashboard, exact: true },
    { title: t('admin.analytics'), path: '/admin/analytics', icon: BarChart3 },
    { title: t('admin.experiments'), path: '/admin/experiments', icon: FlaskConical },
    { title: t('admin.users'), path: '/admin/users', icon: Users },
    { title: t('admin.reports'), path: '/admin/reports', icon: Flag },
    { title: t('admin.features'), path: '/admin/features', icon: SlidersHorizontal },
    { title: t('admin.monetization'), path: '/admin/monetization', icon: DollarSign },
    { title: t('admin.content'), path: '/admin/content', icon: Package },
    { title: t('admin.photos'), path: '/admin/photos', icon: Image },
    { title: t('admin.messaging'), path: '/admin/messaging', icon: Mail },
    { title: t('admin.hangouts'), path: '/admin/hangouts', icon: CalendarDays },
    { title: t('admin.partners'), path: '/admin/partners', icon: Handshake },
    { title: t('admin.backup'), path: '/admin/backup', icon: DatabaseBackup },
    { title: t('admin.webhooks'), path: '/admin/webhooks', icon: Webhook },
  ];

  const isActive = (path: string, exact?: boolean) => exact ? pathname === path : pathname === path;

  return (
    <>
      <SidebarHeader className="border-b border-slate-700/50 flex items-center justify-between p-4">
        <Link to="/admin" className="flex items-center gap-2 font-black text-lg text-white">
          <Shield className="h-6 w-6 text-primary" />
          {!collapsed && <span>SwiftMatch</span>}
        </Link>
        <Button variant="ghost" size="icon" className="hidden md:flex text-slate-400 hover:text-white hover:bg-slate-700/50" onClick={toggleSidebar}>
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </Button>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          {NAV_ITEMS.map(item => (
            <SidebarMenuItem key={item.path}>
              <SidebarMenuButton asChild isActive={isActive(item.path, item.exact)} tooltip={item.title}
                className="text-slate-400 hover:text-white hover:bg-slate-700/50 data-[active=true]:bg-primary/20 data-[active=true]:text-primary">
                <NavLink to={item.path} end={item.exact}>
                  <item.icon />
                  <span>{item.title}</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="mt-auto border-t border-slate-700/50 p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton tooltip={t('admin.language')} className="text-slate-400 hover:text-white hover:bg-slate-700/50">
                  <Languages />
                  <span>{t('admin.language')}: {language}</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="min-w-[140px]">
                <DropdownMenuItem onClick={() => setLanguage('RU')}>
                  <span className="flex-1">Русский</span>
                  {language === 'RU' && <Check size={14} />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage('EN')}>
                  <span className="flex-1">English</span>
                  {language === 'EN' && <Check size={14} />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('admin.back_to_app')} className="text-slate-400 hover:text-white hover:bg-slate-700/50">
              <Link to="/"><Home /><span>{t('admin.back_to_app')}</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t('admin.logout')} className="text-slate-400 hover:text-white hover:bg-slate-700/50">
              <Link to="/login"><LogOut /><span>{t('admin.logout')}</span></Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
