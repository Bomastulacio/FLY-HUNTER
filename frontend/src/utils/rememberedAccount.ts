import type { User } from '@supabase/supabase-js';

const storageKey = 'fh_last_google_account_v1';

export type RememberedAccount = { email: string; name: string; avatarUrl?: string };

export function getRememberedGoogleAccount(): RememberedAccount | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const account = JSON.parse(raw);
    if (typeof account.email !== 'string' || !account.email.includes('@')) return null;
    return {
      email: account.email,
      name: typeof account.name === 'string' && account.name ? account.name : account.email.split('@')[0],
      avatarUrl: typeof account.avatarUrl === 'string' && /^https:\/\//.test(account.avatarUrl) ? account.avatarUrl : undefined,
    };
  } catch { return null; }
}

export function rememberGoogleAccount(user: User): void {
  const providers = user.app_metadata?.providers;
  if (user.app_metadata?.provider !== 'google' && !providers?.includes('google')) return;
  if (!user.email) return;
  const metadata = user.user_metadata || {};
  const account: RememberedAccount = {
    email: user.email,
    name: metadata.given_name || metadata.full_name || metadata.name || user.email.split('@')[0],
    avatarUrl: metadata.avatar_url || metadata.picture,
  };
  try { localStorage.setItem(storageKey, JSON.stringify(account)); } catch { /* Storage may be disabled. */ }
}
