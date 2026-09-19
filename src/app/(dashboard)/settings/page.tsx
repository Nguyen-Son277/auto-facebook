import { requireCurrentUser } from "@/lib/dal";
import PageHeader from "@/components/page-header";
import {
  AiSettingsForm,
  PexelsSettingsForm,
} from "@/components/settings-forms";
import DriveSettingsCard, { type DriveResult } from "@/components/drive-settings-card";
import ChangePasswordForm from "@/components/change-password-form";
import ThemeSelector from "@/components/theme-selector";
import { getUserSettingsMeta, getUserSetting, SETTING_KEYS } from "@/lib/settings";
import { fetchAiModels } from "@/lib/ai";
import { getDriveStatus } from "@/app/actions/drive";

// Cấu hình Facebook đã chuyển sang /facebook-apps (theo từng workspace,
// nhiều App cùng lúc) — Settings chỉ còn AI + Pexels.
const ALL_KEYS: string[] = [
  ...Object.values(SETTING_KEYS.AI),
  ...Object.values(SETTING_KEYS.PEXELS),
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string; msg?: string }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;
  const { masked, savedKeys } = await getUserSettingsMeta(user.id, [...ALL_KEYS]);
  const themePref = (await getUserSetting(user.id, SETTING_KEYS.APP.theme)) ?? "system";
  const driveStatus = await getDriveStatus();

  // Chỉ nhận các mã trạng thái do /api/drive/callback sinh ra
  const DRIVE_RESULTS: DriveResult[] = [
    "connected",
    "denied",
    "error",
    "not_configured",
    "missing_redirect",
  ];
  const driveResult: DriveResult =
    sp.drive && (DRIVE_RESULTS as string[]).includes(sp.drive)
      ? (sp.drive as DriveResult)
      : null;

  // Nếu đã có Base URL + API Key → tải sẵn danh sách model để người dùng
  // chọn ngay khi mở trang, không phải gõ tên model.
  const aiReady = Boolean(masked["ai.baseUrl"] && savedKeys.has("ai.apiKey"));
  const aiModels = aiReady ? await fetchAiModels(user.id) : null;

  return (
    <div>
      <PageHeader
        title="Cài đặt"
        description="Cấu hình các tích hợp — key được mã hóa AES-256-GCM trước khi lưu vào database"
      />

      <div className="space-y-5">
        {/* ================= Giao diện ================= */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-xl">
              🎨
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">Giao diện</h2>
              <p className="text-xs text-gray-500">
                Chọn theme sáng hoặc tối — áp dụng ngay và lưu theo tài khoản
              </p>
            </div>
          </div>
          <div className="mt-4">
            <ThemeSelector
              current={
                themePref === "light" || themePref === "dark" || themePref === "system"
                  ? themePref
                  : "system"
              }
            />
          </div>
        </section>

        <AiSettingsForm
          masked={masked}
          initialModels={aiModels?.models ?? []}
          initialModelsError={
            aiModels && !aiModels.ok ? aiModels.error : undefined
          }
        />
        <PexelsSettingsForm masked={masked} />

        {/* ================= Google Drive cá nhân =================
            Nguồn ảnh/video thứ ba, ngang hàng Pexels và "tải từ máy".
            Thư mục cho từng thương hiệu chọn ở trang Thương hiệu. */}
        <DriveSettingsCard
          status={driveStatus}
          result={driveResult}
          detail={sp.msg}
        />

        {/* Tự động đăng bài (công tắc cấp hệ thống) đã chuyển về trang
            Quản trị — chỉ admin điều khiển được. User thường không thấy. */}

        {/* ================= Đổi mật khẩu ================= */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-xl">
              🔑
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">Tài khoản &amp; bảo mật</h2>
              <p className="text-xs text-gray-500">
                Đổi mật khẩu đăng nhập — mật khẩu mới cần tối thiểu 8 ký tự, có chữ và số
              </p>
            </div>
          </div>

          <ChangePasswordForm
            email={user.email}
            forced={user.mustChangePassword}
            inline
          />
        </section>
      </div>
    </div>
  );
}
