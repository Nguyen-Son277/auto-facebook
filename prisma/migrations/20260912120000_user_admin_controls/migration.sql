-- ============================================================
-- USER ADMIN CONTROLS
--
-- Quản trị tài khoản:
-- - status: null (kế thừa) | PENDING | APPROVED | REJECTED
-- - mustChangePassword: buộc đổi mật khẩu lần đầu (admin cấp mật khẩu tạm)
-- - passwordChangedAt: mốc đổi mật khẩu gần nhất
--
-- Chỉ thêm cột nullable/default — không mất dữ liệu.
-- ============================================================

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "status" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "passwordChangedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("id", "email", "name", "password", "role", "status",
    "mustChangePassword", "passwordChangedAt", "createdAt", "updatedAt")
SELECT "id", "email", "name", "password", "role", NULL,
    false, NULL, "createdAt", "updatedAt"
FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

PRAGMA foreign_keys=ON;
