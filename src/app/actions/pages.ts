"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getFacebookConfig, setSetting, SETTING_KEYS } from "@/lib/settings";
import {
  exchangeForLongLivedToken,
  syncPagesToDb,
} from "@/lib/facebook";

export type PageActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  details?: string[];
} | null;

/** Đồng bộ danh sách Pages: nhận User Access Token, đổi sang long-lived, fetch /me/accounts, upsert DB. */
export async function syncFacebookPages(
  _prev: PageActionState,
  formData: FormData
): Promise<PageActionState> {
  const user = await requireCurrentUser();

  const fb = await getFacebookConfig();
  if (!fb.appId || !fb.appSecret) {
    return {
      error:
        "Chưa cấu hình FACEBOOK_APP_ID / APP_SECRET — vào Cài đặt → Facebook Graph API nhập trước.",
    };
  }

  const inputToken = String(formData.get("userToken") ?? "").trim();
  if (!inputToken) {
    return { error: "Vui lòng dán User Access Token." };
  }

  try {
    // 1) Đổi token long-lived (token đầu vào có thể là short-lived từ Graph Explorer)
    let accessToken = inputToken;
    let expiresInSeconds = 0;
    try {
      const exchanged = await exchangeForLongLivedToken(inputToken);
      accessToken = exchanged.accessToken;
      expiresInSeconds = exchanged.expiresInSeconds;
    } catch {
      // Token có thể đã là long-lived → dùng trực tiếp
      accessToken = inputToken;
    }

    // 2) Lưu token để lần sau đồng bộ lại không cần dán
    await setSetting(SETTING_KEYS.FACEBOOK.userToken, accessToken);
    await setSetting(
      SETTING_KEYS.FACEBOOK.userTokenExpiresAt,
      String(Date.now() + (expiresInSeconds || 60 * 24 * 3600) * 1000)
    );

    // 3) Fetch pages + upsert DB
    const count = await syncPagesToDb(user.id, accessToken, expiresInSeconds);

    revalidatePath("/pages");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: `Đồng bộ thành công ${count} Page.`,
      details: [
        "Page Access Token (long-lived) đã được lưu vào DB.",
        "Giờ bạn có thể đăng bài ở trang Soạn bài.",
      ],
    };
  } catch (err) {
    return {
      ok: false,
      error: `Đồng bộ thất bại: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function togglePageActive(pageId: string): Promise<void> {
  const user = await requireCurrentUser();
  const page = await prisma.facebookPage.findUnique({ where: { id: pageId } });
  if (!page || page.userId !== user.id) return;

  await prisma.facebookPage.update({
    where: { id: pageId },
    data: { isActive: !page.isActive },
  });
  revalidatePath("/pages");
  revalidatePath("/dashboard");
}

export async function deletePage(pageId: string): Promise<void> {
  const user = await requireCurrentUser();
  const page = await prisma.facebookPage.findUnique({ where: { id: pageId } });
  if (!page || page.userId !== user.id) return;

  await prisma.facebookPage.delete({ where: { id: pageId } });
  revalidatePath("/pages");
  revalidatePath("/dashboard");
}
