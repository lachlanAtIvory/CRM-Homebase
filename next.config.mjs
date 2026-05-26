// Public host that serves Ivory Concierge (no CRM routes).
// When a request comes in on this host we rewrite "/" → "/concierge/ivory-suites"
// and "/{slug}" → "/concierge/{slug}" so guests see clean branded URLs like
// concierge.agentivory.com/ivory-suites instead of /concierge/ivory-suites.
const CONCIERGE_HOST = "concierge.agentivory.com";

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

  async rewrites() {
    return [
      // Root → default demo hotel
      {
        source:      "/",
        has:         [{ type: "host", value: CONCIERGE_HOST }],
        destination: "/concierge/ivory-suites",
      },
      // Pretty hotel URL: concierge.agentivory.com/ivory-suites
      {
        source:      "/:slug",
        has:         [{ type: "host", value: CONCIERGE_HOST }],
        destination: "/concierge/:slug",
      },
      // Pretty QR URL: concierge.agentivory.com/ivory-suites/qr
      {
        source:      "/:slug/qr",
        has:         [{ type: "host", value: CONCIERGE_HOST }],
        destination: "/concierge/:slug/qr",
      },
    ];
  },
};

export default nextConfig;
