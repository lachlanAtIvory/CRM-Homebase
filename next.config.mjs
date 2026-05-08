/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // ESLint is checked separately; don't block production builds
    ignoreDuringBuilds: true,
  },
  typescript: {
    // TypeScript is checked separately; don't block production builds
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
