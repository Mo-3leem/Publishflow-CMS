import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/server/auth/current-user';
import { getPublicSettings } from '@/server/services/settings-service';
import { getEnv } from '@/server/env';
import { LoginForm } from '@/components/admin/login-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  // An already-authenticated user has no business on the login screen.
  if (await getCurrentUser()) redirect('/admin');

  const settings = getPublicSettings();
  const env = getEnv();

  return (
    <div className="bg-ink-50 flex min-h-dvh flex-col justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="text-center">
          <span
            aria-hidden="true"
            className="bg-brand-600 mx-auto flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white"
          >
            {settings.siteName.slice(0, 1).toUpperCase()}
          </span>
          <h1 className="text-ink-900 mt-5 text-2xl font-bold tracking-tight">
            Sign in to {settings.siteName}
          </h1>
          <p className="text-ink-500 mt-1.5 text-sm">
            Staff accounts only. There is no public registration.
          </p>
        </div>

        <div className="border-ink-200 mt-8 rounded-xl border bg-white p-6 shadow-sm">
          <LoginForm />
        </div>

        {!env.isProduction ? (
          <div className="border-ink-300 text-ink-600 mt-6 rounded-lg border border-dashed bg-white p-4 text-xs">
            <p className="text-ink-800 font-semibold">Development demo accounts</p>
            <p className="mt-1">
              Passwords are read from <code className="bg-ink-100 rounded px-1">.env</code>.
              Defaults from <code className="bg-ink-100 rounded px-1">.env.example</code>:
            </p>
            <ul className="mt-2 space-y-0.5 font-mono">
              <li>{env.SEED_ADMIN_EMAIL} — Admin</li>
              <li>{env.SEED_EDITOR_EMAIL} — Editor</li>
              <li>{env.SEED_AUTHOR_EMAIL} — Author</li>
            </ul>
          </div>
        ) : null}

        <p className="mt-6 text-center text-sm">
          <Link
            href="/"
            className="text-ink-500 hover:text-ink-800 underline-offset-4 hover:underline"
          >
            ← Back to the public site
          </Link>
        </p>
      </div>
    </div>
  );
}
