import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.trycloudflare.com'],
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // better-sqlite3, argon2 and sharp are native addons. They must stay external
  // so the server bundle `require()`s them instead of trying to bundle .node files.
  serverExternalPackages: ['better-sqlite3', 'argon2', 'sharp'],
  outputFileTracingIncludes: {
    '/api/**': ['./drizzle/**/*'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
