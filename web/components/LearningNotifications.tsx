'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Notice = { id: string; title: string; body: string; href: string | null; read_at: string | null };

export default function LearningNotifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  useEffect(() => { const supabase = createClient(); if (!supabase) return; void supabase.from('learning_notifications').select('id, title, body, href, read_at').order('created_at', { ascending: false }).limit(8).then(({ data }) => setItems((data ?? []) as Notice[])); }, []);
  const unread = items.filter((item) => !item.read_at).length;
  const markRead = async (item: Notice) => { const supabase = createClient(); if (!supabase || item.read_at) return; await supabase.from('learning_notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id); setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry)); };
  return <div className="relative z-[70]"><button type="button" onClick={() => setOpen((value) => !value)} aria-label="Learning notifications" className="relative rounded-xl border border-border-soft bg-card px-3 py-2 text-sm text-foreground hover:bg-secondary">🔔{unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread}</span>}</button>{open && <div className="absolute right-0 top-12 z-[80] w-80 rounded-2xl border border-border-soft bg-card p-3 shadow-2xl"><p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-primary">Learning updates</p>{items.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No new updates.</p> : items.map((item) => <Link key={item.id} href={item.href ?? '#'} onClick={() => void markRead(item)} className={`block rounded-xl p-3 hover:bg-secondary ${item.read_at ? '' : 'bg-primary/5'}`}><p className="text-sm font-semibold text-foreground">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.body}</p></Link>)}</div>}</div>;
}
