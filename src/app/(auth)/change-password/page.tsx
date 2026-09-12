import type { Metadata } from "next";
import { requireCurrentUser } from "@/lib/dal";
import ChangePasswordForm from "@/components/change-password-form";

export const metadata: Metadata = {
  title: "Đổi mật khẩu | FB Marketing Auto",
};

export default async function ChangePasswordPage() {
  const user = await requireCurrentUser();

  return (
    <ChangePasswordForm
      email={user.email}
      forced={user.mustChangePassword}
    />
  );
}
