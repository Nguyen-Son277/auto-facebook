import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";

/** Khung chung cho mọi trang công khai (trang chủ, chính sách bảo mật, điều khoản). */
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
