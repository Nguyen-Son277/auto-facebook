"use client";

import { useActionState, useState } from "react";
import {
  saveAiSettings,
  savePexelsSettings,
  saveFacebookSettings,
  type ActionState,
} from "@/app/actions/settings";

export type MaskedSettings = Record<string, string>;

function StatusAlert({ state }: { state: ActionState }) {
  if (!state || (!state.ok && !state.error)) return null;
  if (state.error) {
    return (
      <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        <p className="font-medium">✗ {state.error}</p>
        {state.details?.map((d, i) => (
          <p key={i} className="mt-1 break-words font-mono text-xs opacity-80">
            {d}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
      <p className="font-medium">✓ {state.message}</p>
      {state.details?.map((d, i) => (
        <p key={i} className="mt-1 text-xs opacity-80">
          {d}
        </p>
      ))}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";
const btnPrimary =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";

// ============================================================
// AI Provider
// ============================================================

export function AiSettingsForm({
  masked,
  initialModels,
  initialModelsError,
}: {
  masked: MaskedSettings;
  initialModels: string[];
  initialModelsError?: string;
}) {
  const [state, action, pending] = useActionState(saveAiSettings, null);

  // Controlled inputs: giữ nguyên giá trị người dùng đã gõ qua mỗi lần
  // server action trả về (nếu để uncontrolled, giá trị sẽ bị mất sau khi
  // bấm "Tải danh sách model" vì form bị render lại).
  const [baseUrl, setBaseUrl] = useState(masked["ai.baseUrl"] ?? "");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(masked["ai.model"] ?? "");

  // Danh sách model: ưu tiên kết quả vừa tải, sau đó tới danh sách server tải sẵn
  const models = state?.models?.length ? state.models : initialModels;
  const modelsError = state?.models?.length
    ? state.modelsError
    : state?.ok
      ? undefined
      : (state?.modelsError ?? initialModelsError);

  const modelListId = "ai-model-options";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-xl">
            🤖
          </span>
          <div>
            <h2 className="font-semibold text-gray-900">
              AI Provider ([OI]-compatible)
            </h2>
            <p className="text-xs text-gray-500">
              Chỉ cần Base URL + API Key — danh sách model tự tải từ provider
            </p>
          </div>
        </div>
        {masked["ai.apiKey"] && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
            Đã cấu hình
          </span>
        )}
      </div>

      <form action={action} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Base URL
          </label>
          <input
            name="baseUrl"
            type="text"
            className={inputCls}
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-400">
            Nhập tới phần <code>/v1</code> — hệ thống tự gọi <code>/models</code> để lấy danh sách model.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            API Key{" "}
            {masked["ai.apiKey"] && (
              <span className="font-mono text-xs text-gray-400">
                (đã lưu: {masked["ai.apiKey"]})
              </span>
            )}
          </label>
          <input
            name="apiKey"
            type="password"
            className={inputCls}
            placeholder={masked["ai.apiKey"] ? "Bỏ trống để giữ key hiện tại" : "sk-..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium text-violet-900">
              Model{" "}
              {models.length > 0 && (
                <span className="font-normal text-violet-700">
                  ({models.length} model — gõ để tìm nhanh)
                </span>
              )}
            </label>
            <button
              type="submit"
              name="intent"
              value="load"
              disabled={pending}
              className="shrink-0 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
            >
              {pending ? "Đang tải..." : "⬇ Tải danh sách model"}
            </button>
          </div>

          <input
            name="model"
            type="text"
            list={modelListId}
            className={`${inputCls} mt-2 bg-white`}
            placeholder={
              models.length > 0
                ? "Chọn model từ danh sách hoặc gõ để tìm..."
                : 'Bấm "Tải danh sách model" để lấy danh sách'
            }
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <datalist id={modelListId}>
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          {models.length > 0 && !modelsError && (
            <p className="mt-1 text-xs text-emerald-600">
              ✓ Danh sách model đã sẵn sàng — chọn model rồi bấm lưu.
            </p>
          )}
          {modelsError && <p className="mt-1 text-xs text-amber-600">⚠ {modelsError}</p>}
          {models.length === 0 && !modelsError && (
            <p className="mt-1 text-xs text-violet-700/70">
              Nhập Base URL + API Key rồi bấm &quot;Tải danh sách model&quot; — bạn không cần gõ tên model.
            </p>
          )}
        </div>

        <StatusAlert state={state} />

        <div className="flex gap-2">
          <button type="submit" name="intent" value="save" disabled={pending} className={btnGhost}>
            {pending ? "Đang xử lý..." : "Chỉ lưu"}
          </button>
          <button type="submit" name="intent" value="test" disabled={pending} className={btnPrimary}>
            {pending ? "Đang kiểm tra..." : "Lưu & Kiểm tra kết nối"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================
// Pexels
// ============================================================

export function PexelsSettingsForm({ masked }: { masked: MaskedSettings }) {
  const [state, action, pending] = useActionState(savePexelsSettings, null);
  const [apiKey, setApiKey] = useState("");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-xl">
            🖼️
          </span>
          <div>
            <h2 className="font-semibold text-gray-900">Pexels API</h2>
            <p className="text-xs text-gray-500">
              Nguồn ảnh & video cho bài đăng — miễn phí tại pexels.com/api
            </p>
          </div>
        </div>
        {masked["pexels.apiKey"] && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
            Đã cấu hình
          </span>
        )}
      </div>

      <form action={action} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            API Key{" "}
            {masked["pexels.apiKey"] && (
              <span className="font-mono text-xs text-gray-400">
                (đã lưu: {masked["pexels.apiKey"]})
              </span>
            )}
          </label>
          <input
            name="apiKey"
            type="password"
            className={inputCls}
            placeholder={
              masked["pexels.apiKey"] ? "Bỏ trống để giữ key hiện tại" : "Dán Pexels API Key"
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        <StatusAlert state={state} />

        <div className="flex gap-2">
          <button type="submit" name="intent" value="save" disabled={pending} className={btnGhost}>
            {pending ? "Đang xử lý..." : "Chỉ lưu"}
          </button>
          <button type="submit" name="intent" value="test" disabled={pending} className={btnPrimary}>
            {pending ? "Đang kiểm tra..." : "Lưu & Kiểm tra kết nối"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================
// Facebook Graph API
// ============================================================

export function FacebookSettingsForm({
  masked,
  hasToken,
}: {
  masked: MaskedSettings;
  hasToken: boolean;
}) {
  const [state, action, pending] = useActionState(saveFacebookSettings, null);

  const [appId, setAppId] = useState(masked["facebook.appId"] ?? "");
  const [appSecret, setAppSecret] = useState("");
  const [graphVersion, setGraphVersion] = useState(
    masked["facebook.graphVersion"] ?? "v21.0"
  );
  const [userToken, setUserToken] = useState("");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-xl">
            📘
          </span>
          <div>
            <h2 className="font-semibold text-gray-900">Facebook Graph API</h2>
            <p className="text-xs text-gray-500">
              App ID + App Secret để lấy và gia hạn token đăng bài
            </p>
          </div>
        </div>
        {hasToken ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
            Đã có token
          </span>
        ) : masked["facebook.appSecret"] ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
            Còn thiếu token
          </span>
        ) : null}
      </div>

      <form action={action} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">App ID</label>
            <input
              name="appId"
              type="text"
              className={inputCls}
              placeholder="1234567890"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              App Secret{" "}
              {masked["facebook.appSecret"] && (
                <span className="font-mono text-xs text-gray-400">
                  (đã lưu: {masked["facebook.appSecret"]})
                </span>
              )}
            </label>
            <input
              name="appSecret"
              type="password"
              className={inputCls}
              placeholder={
                masked["facebook.appSecret"]
                  ? "Bỏ trống để giữ secret hiện tại"
                  : "Dán App Secret"
              }
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Graph API Version
          </label>
          <input
            name="graphVersion"
            type="text"
            className={inputCls}
            placeholder="v21.0"
            value={graphVersion}
            onChange={(e) => setGraphVersion(e.target.value)}
          />
          <p className="mt-1 text-xs text-gray-400">
            Chỉ đổi nếu bạn biết mình đang làm gì — version quá cũ sẽ bị Meta tắt.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            User Access Token (tùy chọn — để đồng bộ Pages ngay tại đây)
          </label>
          <input
            name="userToken"
            type="password"
            className={inputCls}
            placeholder="Dán token từ Graph API Explorer (quyền pages_show_list, pages_manage_posts)"
            value={userToken}
            onChange={(e) => setUserToken(e.target.value)}
          />
        </div>

        <StatusAlert state={state} />

        <div className="flex gap-2">
          <button type="submit" name="intent" value="save" disabled={pending} className={btnGhost}>
            {pending ? "Đang xử lý..." : "Chỉ lưu"}
          </button>
          <button type="submit" name="intent" value="test" disabled={pending} className={btnPrimary}>
            {pending ? "Đang lưu & kiểm tra..." : "Lưu & Kiểm tra kết nối"}
          </button>
        </div>
      </form>

      <p className="mt-3 text-xs text-gray-400">
        Hướng dẫn: mở{" "}
        <a
          className="text-blue-500 underline"
          href="https://developers.facebook.com/tools/explorer/"
          target="_blank"
          rel="noreferrer"
        >
          Graph API Explorer
        </a>{" "}
        → chọn app của bạn → chọn quyền <code>pages_show_list</code>,{" "}
        <code>pages_manage_posts</code>, <code>pages_read_engagement</code> → Generate
        Access Token → dán vào ô trên.
      </p>
    </div>
  );
}
