'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConfigNotice from '@/components/ConfigNotice';
import AuthLayout from '@/components/AuthLayout';
import LoadingIndicator from '@/components/LoadingIndicator';
import { useLanguage } from '@/components/LanguageProvider';
import { APP_CONFIG } from '@/constants/config';
import { getErrorMessage } from '@/lib/errors';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password first.');
      return;
    }
    const supabase = createClient();
    if (!supabase) {
      setError('Supabase is not configured in this browser session. Restart the web dev server after checking web/.env.local.');
      return;
    }
    setLoading(true);
    setError(undefined);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) throw authError;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', (await supabase.auth.getUser()).data.user?.id ?? '').maybeSingle();
      router.push(profile?.role === 'student' ? '/learning-videos?mode=live' : '/dashboard');
      router.refresh();
    } catch (cause) {
      setError(getErrorMessage(cause, 'Unable to sign in.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
        <div>
          <p className="text-xs font-bold tracking-[0.15em] text-primary">{t('auth.welcomeBackEyebrow')}</p>
          <h1 className="mt-2 text-3xl font-bold text-foreground">{t('auth.signInTitle', { name: APP_CONFIG.name })}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('auth.signInSubtitle')}</p>

          {!isSupabaseConfigured && (
            <div className="mt-6">
              <ConfigNotice />
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-8 space-y-5" aria-busy={loading}>
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="email">
                {t('auth.email')}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3.5 py-3 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:bg-card"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground" htmlFor="password">
                {t('auth.password')}
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-border bg-background px-3.5 py-3 text-sm text-foreground shadow-sm outline-none transition focus:border-primary focus:bg-card"
              />
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </div>

            <div className="flex justify-end">
              <Link href="/forgot-password" className="text-sm text-primary">
                {t('auth.forgotPassword')}
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              {loading ? t('auth.signingIn') : t('auth.signIn')}
            </button>
            {loading && <LoadingIndicator compact />}
          </form>
          <p className="mt-7 border-t border-border-soft pt-6 text-center text-sm text-muted-foreground">New to School Buddy? <Link href="/signup" className="font-bold text-primary hover:underline">Learn how to join</Link></p>
        </div>
    </AuthLayout>
  );
}
