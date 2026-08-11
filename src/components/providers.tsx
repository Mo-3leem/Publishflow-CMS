'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/client/api-client';

/**
 * Client-side data layer for the admin shell.
 *
 * Retries are suppressed for 4xx responses: a 403 or a 409 conflict is a real
 * answer from the server, and retrying it just delays the error the user needs
 * to see.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  // The CSRF cookie is primed by AdminShell, which only renders once a session
  // exists — priming here would fire a guaranteed 401 on the login screen.
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
