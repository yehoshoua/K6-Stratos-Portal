import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/crds', destination: '/tests?tab=executions', permanent: false },
      { source: '/schedules', destination: '/tests?tab=schedules', permanent: false },
    ];
  },
};

export default nextConfig;
