"use client";

import { formatDate } from "@/lib/format-date";

import { useState, useTransition } from "react";
import PasswordInput from "@/components/password-input";
import {
  approveUser,
  changeUserRole,
  createManagedUser,
  deleteUser,
  rejectUser,
  reinstateUser,
  resetUserPassword,
  type AdminState,
} from "@/app/actions/admin";

export type AdminUserRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string | null;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  createdAt: string;
  workspaces: string[];
};

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING: { text: "Chờ duyệt", cls: "bg-amber-100 text-amber-800" },
  APPROVED: { text: "Đã duyệt", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { text: "Bị từ chối/Khóa", cls: "bg-red-100 text-red-700" },
};

function statusBadge(status: string | null, role: string) {
  if (role === "ADMIN") {
    return (
      <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
        Quản trị viên
      </span>
    );
  }
  const s = STATUS_LABEL[status ?? ""] ?? {
    text: "Kế thừa (đang dùng)",
    cls: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
      {s.text}
    </span>
  );
}

export default function AdminClient({
  meEmail,
  users,
}: {
  meEmail: string;
  users: AdminUserRow[];
}) {
  const [notice, setNotice] = useState<AdminState>(null);
  const [busy, startBusy] = useTransition();

  // Form trạng thái: reset/create/delete
  const [resetEmail, setResetEmail] = useState<string | null>(null);
  const [deleteEmail, setDeleteEmail] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);


  async function run(fn: () => Promise<AdminState>): Promise<AdminState> {
    let res: AdminState = null;
    await new Promise<void>((resolve) => {
      startBusy(async () => {
        res = await fn();
        setNotice(res);
        resolve();
      });
    });
    return res;
  }

  const pendingCount = users.filter((u) => u.status === "PENDING").length;
  const approvedCount = users.filter((u) => u.status === "APPROVED").length;
  const rejectedCount = users.filter((u) => u.status === "REJECTED").length;

  return (
    <div className="space-y-6">
      {/* Header + thống kê */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản trị tài khoản</h1>
          <p className="mt-1 text-sm text-gray-500">
            Duyệt đăng ký, cấp/khoá quyền sử dụng hệ thống
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          {showCreate ? "Đóng" : "＋ Tạo tài khoản"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Tổng tài khoản", value: users.length, cls: "text-gray-900" },
          { label: "Chờ duyệt", value: pendingCount, cls: "text-amber-600" },
          { label: "Đã duyệt", value: approvedCount, cls: "text-emerald-600" },
          { label: "Bị từ chối", value: rejectedCount, cls: "text-red-500" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-bold ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Form tạo tài khoản */}
      {showCreate && (
        <form
          action={async (fd) => {
            await run(() => createManagedUser(null, fd));
          }}
          className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4"
        >
          <h2 className="text-sm font-semibold text-gray-900">
            Tạo tài khoản trực tiếp (không cần chờ đăng ký)
          </h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <input
              name="name"
              placeholder="Tên hiển thị"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              name="email"
              type="email"
              required
              placeholder="email@domain.com"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <PasswordInput
              id="create-temp-password"
              name="tempPassword"
              autoComplete="new-password"
              minLength={8}
              placeholder="Mật khẩu tạm (≥8 ký tự)"
              inputClassName="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <select
              name="role"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              defaultValue="USER"
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Đang tạo..." : "Tạo tài khoản"}
          </button>
          <p className="text-xs text-gray-500">
            Người dùng sẽ buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
          </p>
        </form>
      )}

      {/* Thông báo hành động tức thì */}
      {notice?.error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">✗ {notice.error}</p>
      )}
      {notice?.ok && notice.message && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          ✓ {notice.message}
        </p>
      )}

      {/* Bảng user */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Người dùng</th>
              <th className="px-4 py-3">Quyền</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Workspace</th>
              <th className="px-4 py-3">Ngày tạo</th>
              <th className="px-4 py-3 text-right">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((u) => {
              const isMe = u.email === meEmail;
              const isAdmin = u.role === "ADMIN";
              return (
                <tr key={u.id} className={isMe ? "bg-blue-50/40" : ""}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">
                      {u.name || u.email}
                      {isMe && (
                        <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                          bạn
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">{u.email}</p>
                    {u.mustChangePassword && (
                      <p className="text-xs text-amber-600">🔑 chưa đổi mật khẩu tạm</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={isMe || busy}
                      onChange={(e) =>
                        run(() => changeUserRole(u.id, e.target.value as "ADMIN" | "USER"))
                      }
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      <option value="USER">USER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">{statusBadge(u.status, u.role)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {u.workspaces.length ? u.workspaces.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {/* Duyệt đăng ký — chỉ mở khoá, không đụng mật khẩu */}
                      {u.status === "PENDING" && !isAdmin && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Duyệt ${u.email}? Người này sẽ đăng nhập bằng mật khẩu họ đã đăng ký.`
                              )
                            ) {
                              run(() => approveUser(u.id));
                            }
                          }}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          ✓ Duyệt
                        </button>
                      )}
                      {/* Từ chối / khoá */}
                      {!isAdmin && u.status !== "REJECTED" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Từ chối/khoá ${u.email}? Người này sẽ không đăng nhập được nữa.`
                              )
                            ) {
                              run(() => rejectUser(u.id));
                            }
                          }}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          ⛔ Từ chối
                        </button>
                      )}
                      {/* Mở lại */}
                      {!isAdmin && u.status === "REJECTED" && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(() => reinstateUser(u.id))}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          ✓ Mở lại
                        </button>
                      )}
                      {/* Reset mật khẩu */}
                      {!isAdmin && !isMe && (
                        <button
                          type="button"
                          onClick={() => {
                            setResetEmail(u.email);
                            setDeleteEmail(null);
                          }}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          🔑 Reset MK
                        </button>
                      )}
                      {/* Xoá hẳn */}
                      {!isAdmin && !isMe && (
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `XOÁ HẲN ${u.email} cùng TOÀN BỘ dữ liệu (workspace, page, bài đăng)? Hành động này không thể hoàn tác!`
                              ) &&
                              window.confirm(
                                "Xác nhận lần 2: bạn thực sự muốn xoá vĩnh viễn tài khoản này?"
                              )
                            ) {
                              setDeleteEmail(u.email);
                              setResetEmail(null);
                            }
                          }}
                          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          🗑 Xoá
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal reset mật khẩu */}
      {resetEmail && (
        <ModalBackdrop onClose={() => setResetEmail(null)}>
          <h3 className="text-lg font-bold text-gray-900">Reset mật khẩu {resetEmail}</h3>
          <form
            action={async (fd) => {
              const box: { res: AdminState } = { res: null };
              await run(async () => {
                box.res = await resetUserPassword(null, fd);
                return box.res;
              });
              if (box.res?.ok) setResetEmail(null);
            }}
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="userId" value={users.find((u) => u.email === resetEmail)?.id} />
            <PasswordInput
              id="reset-temp-password"
              name="tempPassword"
              autoComplete="new-password"
              minLength={8}
              defaultValue="Abc@12345"
              inputClassName="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetEmail(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
              >
                Huỷ
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Đang lưu..." : "Đặt lại mật khẩu"}
              </button>
            </div>
          </form>
        </ModalBackdrop>
      )}

      {/* Modal xoá — xác nhận email */}
      {deleteEmail && (
        <ModalBackdrop onClose={() => setDeleteEmail(null)}>
          <h3 className="text-lg font-bold text-red-600">Xoá vĩnh viễn {deleteEmail}</h3>
          <p className="mt-1 text-sm text-gray-600">
            Xoá tài khoản cùng toàn bộ workspace, page, bài đăng, thương hiệu của người
            này. <strong>Không thể hoàn tác.</strong>
          </p>
          <form
            action={async (fd) => {
              const box: { res: AdminState } = { res: null };
              await run(async () => {
                box.res = await deleteUser(null, fd);
                return box.res;
              });
              if (box.res?.ok) setDeleteEmail(null);
            }}
            className="mt-4 space-y-3"
          >
            <input type="hidden" name="userId" value={users.find((u) => u.email === deleteEmail)?.id} />
            <input
              name="confirmEmail"
              required
              placeholder={`Gõ đúng email: ${deleteEmail}`}
              className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteEmail(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
              >
                Huỷ
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "Đang xoá..." : "Xoá vĩnh viễn"}
              </button>
            </div>
          </form>
        </ModalBackdrop>
      )}
    </div>
  );
}

function ModalBackdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
