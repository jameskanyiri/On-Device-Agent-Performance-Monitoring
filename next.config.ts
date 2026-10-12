import type { NextConfig } from 'next';

// Cache Components stays off: every page and API route here shows live data
// from the phone, so nothing should be prerendered or cached.
const nextConfig: NextConfig = {};

export default nextConfig;
