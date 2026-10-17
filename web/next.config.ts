import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.1.66', 'localhost', '127.0.0.1'],
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default withNextIntl(nextConfig);
