import { requireCurrentUser } from "@/lib/dal";
import PageHeader from "@/components/page-header";
import {
  AiSettingsForm,
  PexelsSettingsForm,
} from "@/components/settings-forms";
import ChangePasswordForm from "@/components/change-password-form";
import { getUserSettingsMeta, SETTING_KEYS } from "@/lib/settings";
import { fetchAiModels } from "@/lib/ai";

// Cấu hình Facebook đã chuyển sang /facebook-apps (theo từng workspace,
// nhiều App cùng lúc) — Settings chỉ còn AI + Pexels.
const ALL_KEYS: string[] = [
  ...Object.values(SETTING_KEYS.AI),
  ...Object.values(SETTING_KEYS.PEXELS),
];

export default async function SettingsPage() {
  const user = await requireCurrentUser();
  const { masked, savedKeys } = await getUserSettingsMeta(user.id, [...ALL_KEYS]);

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
        <AiSettingsForm
          masked={masked}
          initialModels={aiModels?.models ?? []}
          initialModelsError={
            aiModels && !aiModels.ok ? aiModels.error : undefined
          }
        />
        <PexelsSettingsForm masked={masked} />

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
