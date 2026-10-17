'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SignOutButton from '@/components/SignOutButton';
import { APP_CONFIG } from '@/constants/config';
import { useLanguage } from '@/components/LanguageProvider';
import {
  BookIcon,
  ChatIcon,
  ClipboardIcon,
  GridIcon,
  HomeIcon,
  SettingsIcon,
  TrendingUpIcon,
  UsersIcon,
} from '@/components/icons';
import type { Role } from '@/lib/supabase/profile';

type IconComponent = typeof HomeIcon;

const NAV: Record<Role, { href: string; labelKey: string; label?: string; icon: IconComponent }[]> = {
  admin: [
    { href: '/dashboard', labelKey: 'nav.dashboard', icon: HomeIcon },
    { href: '/ai-chat', labelKey: 'nav.aiChat', icon: ChatIcon },
    { href: '/classes', labelKey: 'nav.classes', icon: GridIcon },
    { href: '/admin/teachers', labelKey: 'nav.teachers', icon: UsersIcon },
    { href: '/admin/students', labelKey: 'nav.students', icon: UsersIcon },
  ],
  vice_principal: [
    { href: '/dashboard', labelKey: 'nav.dashboard', icon: HomeIcon },
    { href: '/ai-chat', labelKey: 'nav.aiChat', icon: ChatIcon },
    { href: '/classes', labelKey: 'nav.classes', icon: GridIcon },
    { href: '/admin/teachers', labelKey: 'nav.teachers', icon: UsersIcon },
    { href: '/admin/students', labelKey: 'nav.students', icon: UsersIcon },
  ],
  teacher: [
    { href: '/dashboard', labelKey: 'nav.dashboard', icon: HomeIcon },
    { href: '/ai-chat', labelKey: 'nav.aiChat', icon: ChatIcon },
    { href: '/discussions', labelKey: 'nav.discussions', icon: BookIcon },
    { href: '/classes', labelKey: 'nav.classes', icon: GridIcon },
    { href: '/students', labelKey: 'nav.students', icon: UsersIcon },
    { href: '/assignments', labelKey: 'nav.assignments', icon: ClipboardIcon },
    { href: '/performance', labelKey: 'nav.performance', icon: TrendingUpIcon },
    { href: '/live-reports', labelKey: 'nav.performance', label: 'Live reports', icon: TrendingUpIcon },
  ],
  student: [
    { href: '/dashboard', labelKey: 'nav.dashboard', icon: HomeIcon },
    { href: '/learning-videos?mode=live', labelKey: 'nav.learningVideos', label: 'Live Voice', icon: ChatIcon },
    { href: '/learning-videos?mode=video', labelKey: 'nav.learningVideos', label: 'Avatar Videos', icon: BookIcon },
    // AI Chat is hidden from the student nav — Discussions covers this
    // role's AI use case now. Route/component/code all still live at
    // /ai-chat, just unlinked here. Re-add this entry to bring it back.
    // { href: '/ai-chat', labelKey: 'nav.aiChat', icon: ChatIcon },
    { href: '/discussions', labelKey: 'nav.discussions', icon: BookIcon },
    { href: '/subjects', labelKey: 'nav.subjects', icon: GridIcon },
    { href: '/assignments', labelKey: 'nav.assignments', icon: ClipboardIcon },
    { href: '/performance', labelKey: 'nav.performance', icon: TrendingUpIcon },
  ],
};

export default function Sidebar({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const items = [...NAV[role], { href: '/settings', labelKey: 'nav.settings', icon: SettingsIcon }];

  return (
    <aside className="app-sidebar flex h-full w-[272px] shrink-0 flex-col bg-[#172554] px-4 py-5 text-white shadow-xl">
      <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.05]">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#5574d2] to-[#3B58B6] text-base font-bold text-white shadow-lg shadow-blue-950/30">
          {APP_CONFIG.name.charAt(0)}
        </div>
        <div><p className="font-heading text-base font-semibold text-white">{APP_CONFIG.name}</p><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Learning platform</p></div>
      </Link>

      <p className="mb-2 mt-8 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-white/35">Workspace</p>
      <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
        {items.map((item) => {
          const active = item.href === '/dashboard' ? pathname === item.href : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                active ? 'bg-gradient-to-r from-[#4d6bc7] to-[#3B58B6] text-white shadow-lg shadow-blue-950/25' : 'text-white/65 hover:bg-white/[0.09] hover:text-white'
              }`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {item.label ?? t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
      <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">Signed in as</p>
        <p className="mt-1 truncate text-sm font-semibold capitalize text-white/85">{role.replace('_', ' ')}</p>
      </div>
      <SignOutButton />
    </aside>
  );
}
