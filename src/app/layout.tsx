import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import InlineScript from "@/components/inline-script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "FB Marketing Auto",
    template: "%s · FB Marketing Auto",
  },
  description:
    "Tự động viết nội dung bằng AI, tìm media từ Pexels và đăng bài lên Facebook Page.",
};

// Script chạy TRƯỚC khi vẽ trang (chống nhấp nháy theme — FOUC):
// ưu tiên cookie "theme" → localStorage "theme" → hệ điều hành.
const THEME_INIT_SCRIPT = `(function(){try{
  var pref = "system";
  var m = document.cookie.match(/(?:^|; )theme=(light|dark|system)/);
  if (m) pref = m[1];
  else {
    var ls = localStorage.getItem("theme");
    if (ls === "light" || ls === "dark" || ls === "system") pref = ls;
  }
  var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
  document.documentElement.dataset.themePref = pref;
}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Script chạy trước lần paint đầu tiên (chống nhấp nháy theme).
            Dùng InlineScript để React 19 không cảnh báo về thẻ <script>. */}
        <InlineScript html={THEME_INIT_SCRIPT} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
