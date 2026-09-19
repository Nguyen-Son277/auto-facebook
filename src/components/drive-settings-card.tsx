"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectDrive, type DriveStatus } from "@/app/actions/drive";
import { startDriveConnect } from "@/lib/drive-connect";

// ============================================================
// Card "Google Drive cá nhân" ở trang Cài đặt.
//
// Người dùng thấy đúng ba việc: đang nối vào tài khoản Google nào, kết nối
// (hoặc cấp quyền lại), và ngắt kết nối. Thư mục cho từng thương hiệu được
// chọn ở trang Thương hiệu — không nhồi vào đây.
// ============================================================

/** Kết quả quay về từ /api/drive/callback (query string ?drive=...). */
export type DriveResult =
  | "connected"
  | "denied"
  | "error"
  | "not_configured"
  | "missing_redirect"
  | null;

const RESULT_MESSAGE: Record<
  Exclude<DriveResult, null>,
  { ok: boolean; text: string }
> = {
  connected: { ok: true, text: "Đã kết nối Google Drive thành công." },
  denied: { ok: false, text: "Bạn đã từ chối cấp quyền — chưa kết nối được Drive." },
  error: { ok: false, text: "Không kết nối được Google Drive." },
  not_configured: {
    ok: false,
    text: "Máy chủ chưa cấu hình GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.",
  },
  missing_redirect: {
    ok: false,
    text: "Chưa xác định được redirect URI — đặt GOOGLE_OAUTH_REDIRECT_URI trong .env.",
  },
};

export default function DriveSettingsCard({
  status,
  result,
  detail,
}: {
  status: DriveStatus;
  result: DriveResult;
  /** Thông báo lỗi chi tiết từ callback (?msg=...). */
  detail?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  const banner = result ? RESULT_MESSAGE[result] : null;
  const needsReauth = status.status === "NEEDS_REAUTH";

  function onDisconnect() {
    startTransition(async () => {
      await disconnectDrive();
      setConfirming(false);
      router.refresh();
    });
  }

  const badge = !status.configured ? (
    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
      Máy chủ chưa cấu hình
    </span>
  ) : status.connected ? (
    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
      Đã kết nối
    </span>
  ) : needsReauth ? (
    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
      Cần cấp quyền lại
    </span>
  ) : (
    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
      Chưa kết nối
    </span>
  );

  return (
    <section
      className="rounded-2xl border border-gray-200 bg-white p-5"
      data-testid="drive-settings-card"
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-100 text-xl">
            📁
          </span>
          <div>
            <h2 className="font-semibold text-gray-900">Google Drive cá nhân</h2>
            <p className="text-xs text-gray-500">
              Lấy ảnh/video có sẵn trong Drive của bạn — mỗi thương hiệu một thư mục riêng,
              không tốn dung lượng hệ thống
            </p>
          </div>
        </div>
        {badge}
      </div>

      {banner ? (
        <div
          data-testid="drive-result"
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            banner.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          <p className="font-medium">
            {banner.ok ? "✓" : "✗"} {banner.text}
          </p>
          {detail ? <p className="mt-1 break-words text-xs opacity-80">{detail}</p> : null}
        </div>
      ) : null}

      {needsReauth && status.lastError ? (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">Kết nối đã hết hiệu lực</p>
          <p className="mt-1 break-words text-xs">{status.lastError}</p>
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-gray-500">Tài khoản Google</dt>
          <dd className="text-gray-900">{status.googleEmail ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Quyền đã cấp</dt>
          <dd className="text-gray-900">
            {status.connected || needsReauth ? "Chỉ tệp do bạn chọn (drive.file)" : "—"}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-gray-500">
        App chỉ xin quyền <span className="font-mono">drive.file</span> — chỉ đọc được tệp bạn
        chọn. Vì vậy sau khi kết nối, vào trang <strong>Thương hiệu</strong> để chọn thư mục cho
        từng thương hiệu.
      </p>

      {!status.configured ? (
        <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Quản trị viên cần tạo OAuth Client trên Google Cloud rồi đặt{" "}
          <span className="font-mono">GOOGLE_OAUTH_CLIENT_ID</span>,{" "}
          <span className="font-mono">GOOGLE_OAUTH_CLIENT_SECRET</span>,{" "}
          <span className="font-mono">GOOGLE_OAUTH_REDIRECT_URI</span> và{" "}
          <span className="font-mono">GOOGLE_PICKER_API_KEY</span>.
        </p>
      ) : !status.pickerReady ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Thiếu <span className="font-mono">GOOGLE_PICKER_API_KEY</span> — vẫn kết nối được nhưng
          KHÔNG chọn được thư mục (Google Picker không mở).
        </p>
      ) : null}

      {status.configured ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="drive-connect"
            onClick={startDriveConnect}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            {status.connected
              ? "Cấp quyền lại"
              : needsReauth || status.googleEmail
                ? "Cấp quyền lại"
                : "Kết nối Google Drive"}
          </button>

          {status.googleEmail && !confirming ? (
            <button
              type="button"
              data-testid="drive-disconnect"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Ngắt kết nối
            </button>
          ) : null}

          {confirming ? (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>Ngắt kết nối Drive?</span>
              <button
                type="button"
                onClick={onDisconnect}
                disabled={pending}
                data-testid="drive-disconnect-confirm"
                className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
              >
                {pending ? "Đang ngắt..." : "Ngắt"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700"
              >
                Huỷ
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
