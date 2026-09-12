/**
 * Chuẩn mật khẩu tối thiểu cho hệ thống — dùng chung giữa trang đăng ký,
 * đổi mật khẩu và admin cấp mật khẩu tạm.
 * (Hàm thuần, không phải server action.)
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Mật khẩu phải có ít nhất 8 ký tự.";
  if (!/[a-zA-Z]/.test(password)) return "Mật khẩu phải có ít nhất một chữ cái.";
  if (!/[0-9]/.test(password)) return "Mật khẩu phải có ít nhất một chữ số.";
  return null;
}
