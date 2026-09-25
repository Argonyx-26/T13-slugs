import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  // This app lives in web/ inside the RV-Hackathon repo; pin the root so a stray lockfile higher up is ignored
  outputFileTracingRoot: path.join(__dirname),
  turbopack: { root: path.join(__dirname) },
  transpilePackages: ['geist'],
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  }
};

export default nextConfig;
