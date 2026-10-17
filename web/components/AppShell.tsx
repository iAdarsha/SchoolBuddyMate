'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { MenuIcon, SparkleIcon, XIcon } from '@/components/icons';
import { APP_CONFIG } from '@/constants/config';
import type { Role } from '@/lib/supabase/profile';
import LearningNotifications from '@/components/LearningNotifications';

const PAGE_NAMES: Record<string, string> = {
  dashboard: 'Dashboard',
  'ai-chat': 'AI Assistant',
  classes: 'Classes',
  teachers: 'Teachers',
  students: 'Students',
  subjects: 'Subjects',
  assignments: 'Assignments',
  discussions: 'Discussions',
  performance: 'Performance',
  settings: 'Settings',
};

export default function AppShell({ role, name, children }: { role: Role; name: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  const activeSegment = segments[0] === 'admin' ? segments[1] : segments[0];
  const pageName = PAGE_NAMES[activeSegment] ?? 'School Buddy';

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-[#171936] px-4 py-3 text-white shadow-md md:hidden">
        <span className="font-heading text-sm font-semibold">{APP_CONFIG.name}</span>
        <div className="flex items-center gap-2"><LearningNotifications /><button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-white/10"
          ><MenuIcon /></button></div>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-foreground/30" onClick={() => setOpen(false)} />}

      <div
        className={`fixed inset-y-0 left-0 z-50 h-screen transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="relative h-full">
          <Sidebar role={role} onNavigate={() => setOpen(false)} />
          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-white/70 hover:bg-white/10"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="app-canvas min-w-0 flex-1">
        <header className="sticky top-0 z-20 hidden h-[76px] items-center justify-between border-b border-border-soft bg-card/90 px-6 backdrop-blur-xl md:flex xl:px-9">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-soft text-foreground hover:bg-secondary"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><span>School Buddy</span><span className="text-muted-foreground-2">/</span><span className="text-primary">{pageName}</span></div>
              <h1 className="mt-0.5 font-heading text-xl font-semibold text-foreground">{pageName}</h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <LearningNotifications />
            <div className="hidden w-52 lg:block"><LanguageSwitcher /></div>
            <div className="h-8 w-px bg-border-soft" />
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block"><p className="max-w-36 truncate text-sm font-bold text-foreground">{name}</p><p className="text-xs capitalize text-muted-foreground">{role.replace('_', ' ')}</p></div>
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info font-bold text-white shadow-md">
                {name.slice(0, 1).toUpperCase()}
                <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-accent"><SparkleIcon width={8} height={8} /></span>
              </div>
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
