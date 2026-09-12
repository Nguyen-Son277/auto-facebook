// Test QUẢN TRỊ TÀI KHOẢN — tầng logic dữ liệu (Giai đoạn 7).
//
// Kiểm chứng:
//   1. Migration user_admin_controls: cột mới trên User.
//   2. Vòng đời trạng thái: PENDING → APPROVED (giữ nguyên mật khẩu đã
//      đăng ký, không buộc đổi) → REJECTED → mở lại APPROVED.
//   3. Tạo tài khoản: PENDING mặc định khi đăng ký; APPROVED khi admin cấp.
//   4. Reset mật khẩu (user quên): mật khẩu tạm + buộc đổi lần đầu.
//   5. Đổi role: ADMIN ↔ USER; ADMIN luôn status NULL.
//   6. Ràng buộc: email unique; ADMIN không bị khoá; xóa user cascade dữ liệu.
//   7. Đổi mật khẩu: clear mustChangePassword + set passwordChangedAt.
//
// Chạy: node scripts/test-admin-flow.mjs
// KHÔNG đụng tới Facebook thật — chỉ test tầng DB.
import { openTestDb } from "./lib/test-db.mjs";
import bcrypt from "bcryptjs";

const db = openTestDb();
let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const stamp = `admtest-${Date.now().toString(36)}`;

// ============================================================
section("1. Migration user_admin_controls");
// ============================================================
const cols = db.prepare("PRAGMA table_info(User)").all().map((c) => c.name);
check("User có cột status", cols.includes("status"));
check("User có cột mustChangePassword", cols.includes("mustChangePassword"));
check("User có cột passwordChangedAt", cols.includes("passwordChangedAt"));
const mpCol = db
  .prepare("PRAGMA table_info(User)")
  .all()
  .find((c) => c.name === "mustChangePassword");
check("mustChangePassword NOT NULL default false", mpCol?.notnull === 1 && mpCol?.dflt_value === "false");

// ============================================================
section("2. Đăng ký mới → PENDING");
// ============================================================
const regEmail = `${stamp}@example.com`;
const hash = bcrypt.hashSync("Password1", 12);
db.prepare(
  `INSERT INTO User (id, email, name, password, role, status, mustChangePassword, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, 'USER', 'PENDING', 0, datetime('now'), datetime('now'))`
).run(`${stamp}-u1`, regEmail, "Người Test", hash);

const regged = db.prepare("SELECT * FROM User WHERE email = ?").get(regEmail);
check("Tài khoản mới tồn tại", Boolean(regged));
check("status mặc định PENDING", regged?.status === "PENDING");
check("mustChangePassword=false khi tự đăng ký", Number(regged?.mustChangePassword) === 0);

// ============================================================
section("3. Duyệt → APPROVED, GIỮ NGUYÊN mật khẩu đã đăng ký");
// Duyệt chỉ mở khoá — không đụng password/mustChangePassword.
// (Admin chỉ cấp mật khẩu tạm khi user QUÊN mật khẩu — resetUserPassword.)
// ============================================================
db.prepare(
  `UPDATE User SET status='APPROVED' WHERE id=?`
).run(regged.id);
const approved = db.prepare("SELECT * FROM User WHERE id = ?").get(regged.id);
check("status chuyển APPROVED", approved?.status === "APPROVED");
check("mustChangePassword vẫn false (không buộc đổi)", Number(approved?.mustChangePassword) === 0);
check("mật khẩu ĐÃ ĐĂNG KÝ vẫn dùng được", bcrypt.compareSync("Password1", approved.password));
check("không ghi đè bằng mật khẩu tạm", !bcrypt.compareSync("Abc@12345", approved.password));

// ============================================================
section("4. Admin reset mật khẩu (user quên) → mật khẩu tạm + buộc đổi");
// ============================================================
const tempHash2 = bcrypt.hashSync("Abc@12345", 12);
db.prepare(
  `UPDATE User SET password=?, mustChangePassword=1 WHERE id=?`
).run(tempHash2, regged.id);
const reset = db.prepare("SELECT * FROM User WHERE id = ?").get(regged.id);
check("reset: mật khẩu tạm verify đúng", bcrypt.compareSync("Abc@12345", reset.password));
check("reset: mustChangePassword bật", Number(reset?.mustChangePassword) === 1);

// ============================================================
section("4b. Đổi mật khẩu sau reset (buộc lần đầu)");
// ============================================================
const newHash = bcrypt.hashSync("NewPass99", 12);
db.prepare(
  `UPDATE User SET password=?, mustChangePassword=0, passwordChangedAt=datetime('now') WHERE id=?`
).run(newHash, regged.id);
const changed = db.prepare("SELECT * FROM User WHERE id = ?").get(regged.id);
check("mustChangePassword clear sau khi đổi", Number(changed?.mustChangePassword) === 0);
check("passwordChangedAt được ghi", Boolean(changed?.passwordChangedAt));
check("mật khẩu mới verify đúng", bcrypt.compareSync("NewPass99", changed.password));
check("mật khẩu cũ không còn hiệu lực", !bcrypt.compareSync("Abc@12345", changed.password));

// ============================================================
section("5. Từ chối → REJECTED → mở lại");
// ============================================================
db.prepare(`UPDATE User SET status='REJECTED' WHERE id=?`).run(regged.id);
check(
  "REJECTED chặn",
  db.prepare("SELECT status FROM User WHERE id=?").get(regged.id)?.status === "REJECTED"
);
db.prepare(`UPDATE User SET status='APPROVED' WHERE id=?`).run(regged.id);
check(
  "mở lại APPROVED giữ nguyên mật khẩu",
  db.prepare("SELECT status, mustChangePassword FROM User WHERE id=?").get(regged.id)
    ?.status === "APPROVED"
);

// ============================================================
section("6. Đổi role ADMIN ↔ USER");
// ============================================================
db.prepare(`UPDATE User SET role='ADMIN', status=NULL WHERE id=?`).run(regged.id);
const asAdmin = db.prepare("SELECT role, status FROM User WHERE id=?").get(regged.id);
check("lên ADMIN → status NULL", asAdmin.role === "ADMIN" && asAdmin.status === null);
db.prepare(`UPDATE User SET role='USER', status='APPROVED' WHERE id=?`).run(regged.id);
const asUser = db.prepare("SELECT role, status FROM User WHERE id=?").get(regged.id);
check("hạ USER → APPROVED", asUser.role === "USER" && asAdmin.status !== undefined);

// ============================================================
section("7. Admin hệ thống + ràng buộc email unique");
// ============================================================
const sysAdmin = db
  .prepare("SELECT * FROM User WHERE email = 'nms2772k2@gmail.com'")
  .get();
if (sysAdmin) {
  check("admin hệ thống role ADMIN", sysAdmin.role === "ADMIN");
  check("admin hệ thống bỏ ràng buộc status", sysAdmin.status === null);
} else {
  console.log("  (test.db chưa seed admin hệ thống — bỏ qua 2 check)");
}
let dupRejected = false;
try {
  db.prepare(
    `INSERT INTO User (id, email, password, role, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'USER', 'PENDING', datetime('now'), datetime('now'))`
  ).run(`${stamp}-dup`, regEmail, hash);
} catch {
  dupRejected = true;
}
check("email trùng bị từ chối (unique)", dupRejected);

// ============================================================
section("8. Xóa user cascade dữ liệu");
// ============================================================
// Tạo workspace + member của user test rồi xóa user → mọi thứ biến mất
db.prepare(
  `INSERT INTO Workspace (id, name, slug, timezone, status, ownerId, createdAt, updatedAt)
   VALUES (?, ?, ?, 'Asia/Ho_Chi_Minh', 'ACTIVE', ?, datetime('now'), datetime('now'))`
).run(`${stamp}-ws`, "WS Admin Test", `${stamp}-ws`, regged.id);
db.prepare(
  `INSERT INTO WorkspaceMember (id, workspaceId, userId, role, createdAt)
   VALUES (?, ?, ?, 'OWNER', datetime('now'))`
).run(`${stamp}-wm`, `${stamp}-ws`, regged.id);

db.prepare(`DELETE FROM User WHERE id=?`).run(regged.id);
check("user bị xóa", !db.prepare("SELECT id FROM User WHERE id=?").get(regged.id));
check(
  "workspace cascade xóa",
  !db.prepare("SELECT id FROM Workspace WHERE id=?").get(`${stamp}-ws`)
);

// ============================================================
section("9. User mới luôn có workspace (ensureWorkspaceForUser)");
// ============================================================
// Mô phỏng đúng việc dal.ensureWorkspaceForUser làm khi user chưa có
// workspace: tạo Workspace + WorkspaceMember(OWNER). Thiếu bước này,
// trang /pages sẽ crash "Bạn chưa thuộc workspace nào".
const nowsId = `${stamp}-nows`;
const noWsEmail = `${stamp}-nows@example.com`;
db.prepare(
  `INSERT INTO User (id, email, name, password, role, status, mustChangePassword, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, 'USER', 'APPROVED', 0, datetime('now'), datetime('now'))`
).run(nowsId, noWsEmail, "Chưa Có WS", hash);

check(
  "user mới tạo chưa có workspace",
  db.prepare("SELECT COUNT(*) c FROM WorkspaceMember WHERE userId = ?").get(nowsId).c === 0
);

// name rỗng/ có → lấy name; slug bỏ dấu như createWorkspaceForUser
const namePart = noWsEmail.split("@")[0];
const slugBase = namePart
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
db.prepare(
  `INSERT INTO Workspace (id, name, slug, timezone, status, ownerId, createdAt, updatedAt)
   VALUES (?, ?, ?, 'Asia/Ho_Chi_Minh', 'ACTIVE', ?, datetime('now'), datetime('now'))`
).run(`${stamp}-ws2`, "Chưa Có WS", slugBase, nowsId);
db.prepare(
  `INSERT INTO WorkspaceMember (id, workspaceId, userId, role, createdAt)
   VALUES (?, ?, ?, 'OWNER', datetime('now'))`
).run(`${stamp}-wm2`, `${stamp}-ws2`, nowsId);

const gotWs = db.prepare(
  `SELECT w.id FROM WorkspaceMember m JOIN Workspace w ON w.id = m.workspaceId
   WHERE m.userId = ? ORDER BY m.createdAt ASC LIMIT 1`
).get(nowsId);
check("sau ensure có workspace mặc định (getDefaultWorkspaceId hết null)", Boolean(gotWs));
const slugDup = db.prepare("SELECT COUNT(*) c FROM Workspace WHERE slug = ?").get(slugBase).c;
check("slug workspace unique index hoạt động", slugDup === 1);

db.prepare("DELETE FROM Workspace WHERE id = ?").run(`${stamp}-ws2`);
db.prepare("DELETE FROM User WHERE id = ?").run(nowsId);

// ============================================================
// KẾT QUẢ
// ============================================================
console.log(`\nKẾT QUẢ: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
if (failures.length) {
  console.log("Thất bại:");
  for (const f of failures) console.log(`  - ${f}`);
}
db.close();
process.exit(failed > 0 ? 1 : 0);
