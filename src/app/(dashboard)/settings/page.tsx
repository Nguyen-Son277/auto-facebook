import { requireCurrentUser } from "@/lib/dal";
import PageHeader from "@/components/page-header";
import {
  AiSettingsForm,
  PexelsSettingsForm,
} from "@/components/settings-forms";
import { getSettingsMeta, SETTING_KEYS } from "@/lib/settings";
import { fetchAiModels } from "@/lib/ai";
import { getSchedulerStatus } from "@/lib/scheduler";
import SchedulerToggle from "@/components/scheduler-toggle";

// Cấu hình Facebook đã chuyển sang /facebook-apps (theo từng workspace,
// nhiều App cùng lúc) — Settings chỉ còn AI + Pexels.
const ALL_KEYS: string[] = [
  ...Object.values(SETTING_KEYS.AI),
  ...Object.values(SETTING_KEYS.PEXELS),
];

export default async function SettingsPage() {
  const user = await requireCurrentUser();
  const { masked, savedKeys } = await getSettingsMeta([...ALL_KEYS]);
  const scheduler = await getSchedulerStatus(user.id);

  // Nếu đã có Base URL + API Key → tải sẵn danh sách model để người dùng
  // chọn ngay khi mở trang, không phải gõ tên model.
  const aiReady = Boolean(masked["ai.baseUrl"] && savedKeys.has("ai.apiKey"));
  const aiModels = aiReady ? await fetchAiModels({}) : null;

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

        {/* ================= Tự động đăng bài ================= */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-xl">
              ⏰
            </span>
            <div>
              <h2 className="font-semibold text-gray-900">Tự động đăng bài theo lịch</h2>
              <p className="text-xs text-gray-500">
                Vòng lặp chạy sẵn trong ứng dụng — không cần mở terminal hay cài thêm gì
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                data-testid="settings-scheduler-state"
                className={`rounded-full px-3 py-1 font-semibold ${
                  !scheduler.enabled
                    ? "bg-gray-200 text-gray-700"
                    : scheduler.workerAlive
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                }`}
              >
                {!scheduler.enabled
                  ? "⏸ Đang tắt"
                  : scheduler.workerAlive
                    ? "🟢 Đang chạy"
                    : "⚪ Chờ nhịp đầu tiên"}
              </span>
              {scheduler.pending > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
                  ⏳ {scheduler.pending} bài đang chờ đăng
                </span>
              )}
              {scheduler.awaitingRetry > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
                  🔁 {scheduler.awaitingRetry} bài chờ thử lại
                </span>
              )}
            </div>

            <SchedulerToggle enabled={scheduler.enabled} />

            <p className="text-xs text-gray-500">
              Khi tắt, bài đã hẹn giờ vẫn được giữ nguyên và sẽ đăng ngay khi bạn bật lại
              (nếu đã quá giờ hẹn). Việc đăng bài không phụ thuộc vào trình duyệt —
              bạn có thể đóng trang này.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
