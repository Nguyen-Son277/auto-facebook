"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDriveAccessToken } from "@/app/actions/drive";

// ============================================================
// Google Picker — cho người dùng CHỌN thư mục / tệp trên Drive của họ.
//
// VÌ SAO BẮT BUỘC PHẢI CÓ BƯỚC NÀY
// App chỉ xin scope "drive.file": nó chỉ nhìn thấy file do app tạo hoặc do
// người dùng chọn tường minh. Không có Picker thì app không biết thư mục nào
// của thương hiệu và cũng không được cấp quyền đọc ảnh trong đó.
//
// Chỉ xin scope này (thay vì drive.readonly) giúp app không phải qua quy
// trình xác minh "restricted scope" của Google — đổi lại, người dùng phải
// chọn thư mục một lần cho mỗi thương hiệu.
// ============================================================

type PickerBuilder = {
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (appId: string) => PickerBuilder;
  addView: (view: unknown) => PickerBuilder;
  setCallback: (cb: (data: PickerResponse) => void) => PickerBuilder;
  enableFeature: (feature: unknown) => PickerBuilder;
  setLocale: (locale: string) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};

export type PickerResponse = {
  action?: string;
  docs?: PickerDoc[];
};

export type PickerDoc = {
  id?: string;
  name?: string;
  mimeType?: string;
  url?: string;
  thumbnails?: { url?: string }[];
  sizeBytes?: number;
  durationMillis?: number;
};

/**
 * Object `gapi` do api.js tạo ra.
 *
 * LƯU Ý: chỉ có `load` — KHÔNG có `apis` (đã kiểm tra nội dung script thật).
 * Khai báo sai ở đây từng gây lỗi treo 10 giây, nên giữ đúng thực tế.
 */
type GoogleApi = {
  load?: (name: string, callback: () => void) => void;
};

/** DocsView của Picker: mọi setter đều trả về chính nó (builder). */
type PickerDocsView = {
  setIncludeFolders: (v: boolean) => PickerDocsView;
  setSelectFolderEnabled: (v: boolean) => PickerDocsView;
  setMimeTypes: (types: string) => PickerDocsView;
  setMode: (mode: unknown) => PickerDocsView;
};

type PickerNamespace = {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: unknown) => PickerDocsView;
  ViewId: { DOCS: unknown; FOLDERS: unknown };
  Action: { PICKED: string; CANCEL: string };
  Feature: { SUPPORT_DRIVES: unknown; MULTISELECT_ENABLED: unknown };
};

/** Tham số dùng cho picker ở trang Thương hiệu (chọn thư mục). */
export const FOLDER_PICKER_TOKEN = "FOLDER";

declare global {
  interface Window {
    gapi?: GoogleApi;
    google?: { picker: PickerNamespace };
  }
}

const SCRIPT_ID = "google-api-script";

/** Nạp https://apis.google.com/js/api.js đúng một lần cho cả trang. */
function loadGoogleApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // Đã nạp xong (có gapi.load) → không cần làm gì
  if (typeof window.gapi?.load === "function") return Promise.resolve();

  const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existing) {
    // Script đã có sẵn trong DOM → chờ nó sẵn sàng, KHÔNG gắn lại listener "load"
    // (nếu script đã load xong từ trước thì sự kiện load không bao giờ bắn lại
    // và promise sẽ treo vĩnh viễn).
    return waitForGapi();
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Không tải được Google API."));
    document.head.appendChild(script);
  });
}

/**
 * Chờ `window.gapi` sẵn sàng.
 *
 * ⚠️ BÀI HỌC ĐÃ TRẢ GIÁ — KHÔNG kiểm tra `window.gapi.apis`
 * `apis.google.com/js/api.js` KHÔNG hề tạo thuộc tính `apis` trên `gapi`.
 * (Đã kiểm tra trực tiếp nội dung script: chuỗi "apis" chỉ xuất hiện trong URL
 * `https://apis.google.com/...`; thuộc tính duy nhất được gắn là `load`.)
 * Vì vậy điều kiện `gapi?.apis` KHÔNG BAO GIỜ đúng → treo tới hết timeout.
 *
 * Script cũng gọi `onload` TRƯỚC khi gắn xong `gapi` và `gapi.load`, nên đọc
 * `gapi.load` ngay sau `onload` cũng có thể ra `undefined`. Cách an toàn là chờ
 * đúng thứ mình cần dùng: `gapi.load`.
 */
function waitForGapi(timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();

    const poll = window.setInterval(() => {
      if (typeof window.gapi?.load === "function") {
        window.clearInterval(poll);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        window.clearInterval(poll);
        reject(
          new Error(
            "Không nạp được Google API sau 15 giây — kiểm tra mạng, trình chặn quảng cáo, " +
              "hoặc thử tải lại trang."
          )
        );
      }
    }, 50);
  });
}

/** Tải thư viện Picker và chờ `google.picker` thật sự sẵn sàng. */
async function loadPicker(): Promise<void> {
  await waitForGapi();

  // Gán ra biến cục bộ để TypeScript biết chắc `load` tồn tại (thuộc tính optional).
  const load = window.gapi?.load;
  if (typeof load !== "function") {
    throw new Error("Google API chưa sẵn sàng.");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };

    // `gapi.load` không có nhánh lỗi — chặn trường hợp callback không bao giờ
    // được gọi (mạng chặn, script bị chặn) để UI không treo ở "Đang mở Picker...".
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Google Picker không phản hồi — thử tải lại trang."));
    }, 15_000);

    try {
      load("picker", done);
    } catch (err) {
      window.clearTimeout(timer);
      settled = true;
      reject(err instanceof Error ? err : new Error("Không nạp được Google Picker."));
    }
  });

  // `google.picker` có thể xuất hiện vài nhịp SAU callback của gapi.load.
  const started = Date.now();
  while (!window.google?.picker) {
    if (Date.now() - started > 5_000) {
      throw new Error("Google Picker không khởi tạo được — thử tải lại trang.");
    }
    await new Promise((r) => window.setTimeout(r, 50));
  }
}

/** Danh sách MIME ảnh/video lấy được từ Drive (khớp lib/drive-files.ts). */
export const PICKER_MEDIA_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
].join(",");

export type DrivePickerMode = "folder" | "media";

export function useDrivePicker() {
  const ready = useRef<Promise<void> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Nạp Google API rồi Picker — chỉ chạy MỘT lần cho cả app (script dùng chung).
   *
   * Không nạp sẵn trong useEffect: người dùng có thể bấm nút trước khi effect
   * chạy, lúc đó `ready.current` còn null. Gọi hàm này từ CẢ effect lẫn `open`
   * để dù bấm sớm thế nào cũng không bị treo.
   */
  const ensureReady = useCallback((): Promise<void> => {
    if (!ready.current) {
      ready.current = loadGoogleApi().then(loadPicker);
    }
    return ready.current;
  }, []);

  useEffect(() => {
    // Nạp trước để lần bấm đầu tiên mở Picker ngay, không phải chờ
    void ensureReady().catch(() => {
      // Lỗi mạng sẽ được báo ở lần bấm (open) — không làm phiền khi vừa mở trang
    });
  }, [ensureReady]);

  const open = useCallback(
    async (mode: DrivePickerMode, apiKey: string): Promise<PickerDoc[]> => {
      if (!apiKey) {
        setError(
          "Máy chủ chưa cấu hình GOOGLE_PICKER_API_KEY — không mở được Google Picker."
        );
        return [];
      }

      setLoading(true);
      setError(null);
      try {
        await ensureReady();

        const token = await getDriveAccessToken();
        if (!token.ok) {
          setError(token.error);
          return [];
        }

        const picker = window.google?.picker;
        if (!picker) {
          setError("Google Picker chưa sẵn sàng — thử tải lại trang.");
          return [];
        }

        return await new Promise<PickerDoc[]>((resolve) => {
          const docsView =
            mode === "folder"
              ? new picker.DocsView(picker.ViewId.FOLDERS)
                  .setIncludeFolders(true)
                  .setSelectFolderEnabled(true)
              : new picker.DocsView(picker.ViewId.DOCS)
                  .setIncludeFolders(false)
                  .setMimeTypes(PICKER_MEDIA_MIMES);

          const builder = new picker.PickerBuilder()
            .setOAuthToken(token.accessToken)
            .setDeveloperKey(apiKey)
            .addView(docsView)
            .setLocale("vi")
            .enableFeature(picker.Feature.SUPPORT_DRIVES)
            .setCallback((data) => {
              if (data.action === picker.Action.PICKED) {
                resolve(data.docs ?? []);
              } else if (data.action === picker.Action.CANCEL) {
                resolve([]);
              }
            });

          // CHỌN NHIỀU: chỉ bật ở chế độ chọn ảnh/video.
          //
          // VÌ SAO QUAN TRỌNG: scope `drive.file` cấp quyền theo TỪNG tài nguyên
          // mà người dùng chọn tường minh. Chọn được nhiều tệp một lúc nghĩa là
          // một lần mở Picker lấy được cả bộ ảnh, thay vì mở lại cho từng tấm.
          //
          // KHÔNG bật cho chế độ chọn thư mục: chọn 1 thư mục là đủ, và trộn
          // nhiều thư mục vào một liên kết thương hiệu không có ý nghĩa.
          if (mode === "media") {
            builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
          }

          builder.build().setVisible(true);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không mở được Google Picker.");
        return [];
      } finally {
        setLoading(false);
      }
    },
    [ensureReady]
  );

  return { open, loading, error, clearError: () => setError(null) };
}
