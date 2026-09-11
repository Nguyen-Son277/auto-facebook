import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Ảnh remote từ Pexels (media picker) — dùng <img> nên không cần cấu hình images,
  // nhưng khai báo trước để sẵn sàng nếu chuyển sang next/image.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.pexels.com" }],
  },
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
