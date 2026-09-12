"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { markAllNotificationsRead, markNotificationsRead } from "@/lib/notify";

// ============================================================
// Actions cho hộp thư thông báo (chuông + trang /notifications).
// Mọi id đều được lọc theo userId — không đánh dấu được tin của người khác.
// ============================================================

export type NotifyState = { ok: boolean; count?: number; error?: string } | null;

export async function markReadAction(
  ids: string[]
): Promise<NotifyState> {
  const user = await requireCurrentUser();
  const clean = ids.filter((x) => typeof x === "string" && x.length > 0).slice(0, 100);
  await markNotificationsRead(user.id, clean);
  revalidatePath("/notifications");
  return { ok: true, count: clean.length };
}

export async function markAllReadAction(): Promise<NotifyState> {
  const user = await requireCurrentUser();
  const count = await markAllNotificationsRead(user.id);
  revalidatePath("/notifications");
  return { ok: true, count };
}
