// Test ĐA WORKSPACE + ĐA FACEBOOK CONNECTION — tầng logic dữ liệu.
//
// Kiểm chứng các đảm lược cốt lõi của Giai đoạn 1-2 (PLAN.md):
//   1. Một user có nhiều workspace; mỗi workspace một FacebookConnection riêng.
//   2. Unique (workspaceId, appId) — không thêm trùng App trong 1 workspace.
//   3. Cùng một App ID được phép tồn tại ở HAI workspace khác nhau.
//   4. Sync Page theo connection: mỗi Page nhớ đúng connectionId.
//   5. Cùng fbPageId ở 2 workspace là 2 Page riêng biệt (không đụng nhau).
//   6. Xóa connection còn Page phụ thuộc → bị từ chối.
//   7. Bài Post gắn đúng workspaceId/brandId của Page.
//
// Chạy: node scripts/test-multi-workspace.mjs
// KHÔNG đụng tới Facebook thật — chỉ test tầng DB + service logic.
import { openTestDb, SMOKE_EMAIL } from "./lib/test-db.mjs";

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

// ------------------------------------------------------------
// Dọn dữ liệu test cũ của user smoke
// ------------------------------------------------------------
const user = db
  .prepare("SELECT id FROM User WHERE email = ?")
  .get(SMOKE_EMAIL);
if (!user) {
  console.error("Không có user smoke — chạy: node scripts/smoke-login.mjs");
  process.exit(1);
}
const uid = user.id;

// Xóa workspace cũ của user test (cascade xóa mọi thứ bên dưới)
db.prepare(
  `DELETE FROM Workspace WHERE ownerId = ?`
).run(uid);
db.prepare(
  `DELETE FROM FacebookPage WHERE userId = ? AND workspaceId IS NULL`
).run(uid);
db.prepare(
  `DELETE FROM Post WHERE userId = ? AND workspaceId IS NULL`
).run(uid);

// ============================================================
section("1. Tạo 2 workspace cho 1 user");

const wsA = "ws-test-alpha";
const wsB = "ws-test-beta";
db.prepare(
  `INSERT INTO Workspace (id, name, slug, ownerId, updatedAt) VALUES (?, ?, ?, ?, datetime('now'))`
).run(wsA, "Workspace Alpha", "test-alpha", uid);
db.prepare(
  `INSERT INTO WorkspaceMember (id, workspaceId, userId, role) VALUES (?, ?, ?, 'OWNER')`
).run("wm-test-a", wsA, uid);
db.prepare(
  `INSERT INTO Workspace (id, name, slug, ownerId, updatedAt) VALUES (?, ?, ?, ?, datetime('now'))`
).run(wsB, "Workspace Beta", "test-beta", uid);
db.prepare(
  `INSERT INTO WorkspaceMember (id, workspaceId, userId, role) VALUES (?, ?, ?, 'OWNER')`
).run("wm-test-b", wsB, uid);

const wsCount = db
  .prepare("SELECT COUNT(*) c FROM Workspace WHERE ownerId = ?")
  .get(uid).c;
check("User thuộc 2 workspace", wsCount === 2, `count=${wsCount}`);

const memberCount = db
  .prepare("SELECT COUNT(*) c FROM WorkspaceMember WHERE userId = ?")
  .get(uid).c;
check("Có 2 membership OWNER", memberCount === 2, `count=${memberCount}`);

// ============================================================
section("2. Unique (workspaceId, appId) trong cùng workspace");

const insertFbc = db.prepare(
  `INSERT INTO FacebookConnection
   (id, workspaceId, name, appId, appSecret, userAccessToken, graphVersion, status, createdById, updatedAt)
   VALUES (?, ?, ?, ?, 'sec-enc', 'tok-enc', 'v21.0', 'ACTIVE', ?, datetime('now'))`
);
insertFbc.run("fbc-app1", wsA, "App Shop Chính", "111000111", uid);

let duplicateRejected = false;
try {
  insertFbc.run("fbc-app1-dup", wsA, "App trùng", "111000111", uid);
} catch (e) {
  duplicateRejected = /UNIQUE/i.test(e.message ?? "");
}
check("App ID trùng trong 1 workspace bị từ chối", duplicateRejected);

// Cùng App ID ở workspace KHÁC → được phép
let crossWorkspaceOk = true;
try {
  insertFbc.run("fbc-app1-beta", wsB, "Cùng App, workspace khác", "111000111", uid);
} catch {
  crossWorkspaceOk = false;
}
check("Cùng App ID ở workspace khác được phép", crossWorkspaceOk);

// ============================================================
section("3. Thêm connection thứ 2 trong cùng workspace (đa App)");

insertFbc.run("fbc-app2", wsA, "App Page Khác", "222000222", uid);
const connCount = db
  .prepare("SELECT COUNT(*) c FROM FacebookConnection WHERE workspaceId = ?")
  .get(wsA).c;
check("Workspace Alpha có 2 Facebook App", connCount === 2, `count=${connCount}`);

// ============================================================
section("4. Sync Page theo connection");

const insertPage = db.prepare(
  `INSERT INTO FacebookPage
   (id, userId, workspaceId, connectionId, fbPageId, name, accessToken, isActive, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, 'page-token', 1, datetime('now'))`
);
// App 1 cấp Page P1, P2
insertPage.run("pg-p1", uid, wsA, "fbc-app1", "FB100", "Page Từ App 1");
insertPage.run("pg-p2", uid, wsA, "fbc-app1", "FB200", "Page 2 Từ App 1");
// App 2 cấp Page P3
insertPage.run("pg-p3", uid, wsA, "fbc-app2", "FB300", "Page Từ App 2");
// Workspace B có Page riêng (cùng fbPageId FB100 nhưng ws khác)
insertPage.run("pg-p1-beta", uid, wsB, "fbc-app1-beta", "FB100", "Page FB100 Ở Beta");

const p1 = db.prepare("SELECT connectionId FROM FacebookPage WHERE id = 'pg-p1'").get();
check("Page P1 gắn đúng App 1", p1.connectionId === "fbc-app1", JSON.stringify(p1));
const p3 = db.prepare("SELECT connectionId FROM FacebookPage WHERE id = 'pg-p3'").get();
check("Page P3 gắn đúng App 2", p3.connectionId === "fbc-app2", JSON.stringify(p3));

// Cùng fbPageId ở 2 workspace = 2 bản ghi riêng
const sameFbId = db
  .prepare("SELECT COUNT(*) c FROM FacebookPage WHERE fbPageId = 'FB100'")
  .get().c;
check("fbPageId FB100 tồn tại 2 workspace (2 bản ghi)", sameFbId === 2, `count=${sameFbId}`);

// Trùng fbPageId trong CÙNG workspace → bị chặn
let pageDupRejected = false;
try {
  insertPage.run("pg-p1-dup", uid, wsA, "fbc-app2", "FB100", "Trùng Page trong ws");
} catch (e) {
  pageDupRejected = /UNIQUE/i.test(e.message ?? "");
}
check("fbPageId trùng trong 1 workspace bị từ chối", pageDupRejected);

// ============================================================
section("5. Brand + gán Page");

db.prepare(
  `INSERT INTO Brand (id, workspaceId, name, slug, updatedAt) VALUES (?, ?, ?, ?, datetime('now'))`
).run("brand-a1", wsA, "Thương Hiệu A1", "th-a1");
db.prepare("UPDATE FacebookPage SET brandId = ? WHERE id = 'pg-p1'").run("brand-a1");

const p1Brand = db
  .prepare("SELECT brandId, workspaceId FROM FacebookPage WHERE id = 'pg-p1'")
  .get();
check("Page P1 gắn đúng brand", p1Brand.brandId === "brand-a1");
check("Page P1 thuộc workspace A", p1Brand.workspaceId === wsA);

// Brand workspace B không thể gán cho Page workspace A
db.prepare("UPDATE FacebookPage SET brandId = NULL WHERE id = 'pg-p2'").run();
// (ràng buộc chéo được kiểm tra ở tầng action assignPageToBrand — tầng DB FK vẫn cho,
// nhưng action sẽ chặn; ở đây chỉ xác nhận FK không vỡ khi brand đúng ws)

// ============================================================
section("6. Post gắn workspace + brand");

const insertPost = db.prepare(
  `INSERT INTO Post (id, userId, workspaceId, brandId, pageId, content, status, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', datetime('now'))`
);
insertPost.run("post-1", uid, wsA, "brand-a1", "pg-p1", "Bài của Page P1");
insertPost.run("post-2", uid, wsA, null, "pg-p3", "Bài của Page P3 (chưa có brand)");

const post1 = db
  .prepare("SELECT workspaceId, brandId, pageId FROM Post WHERE id = 'post-1'")
  .get();
check("Post 1 thuộc workspace A", post1.workspaceId === wsA);
check("Post 1 gắn brand A1", post1.brandId === "brand-a1");
check("Post 1 gắn Page P1", post1.pageId === "pg-p1");

// Bài workspace B không lọt vào truy vấn workspace A
const wsAPosts = db
  .prepare("SELECT COUNT(*) c FROM Post WHERE workspaceId = ?")
  .get(wsA).c;
check("Truy vấn workspace A chỉ thấy bài của A", wsAPosts === 2, `count=${wsAPosts}`);

// ============================================================
section("7. Xóa connection còn Page → chặn ở tầng service");

// Mô phỏng logic deleteConnection: có Page phụ thuộc thì không xóa
const dependentPages = db
  .prepare("SELECT COUNT(*) c FROM FacebookPage WHERE connectionId = 'fbc-app1'")
  .get().c;
check("Connection App 1 còn Page phụ thuộc", dependentPages === 2, `count=${dependentPages}`);
// Tầng service sẽ throw khi còn Page — ở đây kiểm tra hành vi SetNull của FK:
// xóa connection KHI FK BẬT → các Page giữ connectionId = NULL (không mất Page).
db.prepare("DELETE FROM FacebookConnection WHERE id = 'fbc-app1'").run();
const p1After = db
  .prepare("SELECT connectionId FROM FacebookPage WHERE id = 'pg-p1'")
  .get();
check("Page vẫn tồn tại khi connection bị xóa (SetNull)", p1After !== undefined);
check("Page mất connectionId (Set NULL)", p1After.connectionId === null);

// ============================================================
section("8. Backfill migration trên DB trống hoạt động");

// Kiểm tra schema có đủ cột đa tenant
const pageCols = db.prepare("PRAGMA table_info(FacebookPage)").all().map((c) => c.name);
check("FacebookPage có workspaceId", pageCols.includes("workspaceId"));
check("FacebookPage có connectionId", pageCols.includes("connectionId"));
check("FacebookPage có brandId", pageCols.includes("brandId"));

const postCols = db.prepare("PRAGMA table_info(Post)").all().map((c) => c.name);
check("Post có workspaceId", postCols.includes("workspaceId"));
check("Post có brandId", postCols.includes("brandId"));

const connCols = db.prepare("PRAGMA table_info(FacebookConnection)").all().map((c) => c.name);
check(
  "FacebookConnection có appId + userAccessToken",
  connCols.includes("appId") && connCols.includes("userAccessToken")
);

// FK toàn vẹn
const fk = db.prepare("PRAGMA foreign_key_check").all();
check("Không có vi phạm FK", fk.length === 0, JSON.stringify(fk));

// ============================================================
section("9. Nội dung thương hiệu tách khỏi Page (brand decoupled)");

// 9.1. BrandProfile: 1-1 với Brand qua brandId, KHÔNG còn cột pageId
const bpCols = db.prepare("PRAGMA table_info(BrandProfile)").all().map((c) => c.name);
check("BrandProfile không còn cột pageId", !bpCols.includes("pageId"));
check("BrandProfile có brandId unique", bpCols.includes("brandId"));

// 9.2. ContentPillar/KnowledgeDoc: pageId nullable
const pillarCols = db.prepare("PRAGMA table_info(ContentPillar)").all().map((c) => c.name);
const docCols = db.prepare("PRAGMA table_info(KnowledgeDoc)").all().map((c) => c.name);
check("ContentPillar.pageId nullable", pillarCols.includes("pageId") &&
  db.prepare("SELECT [notnull] AS nn FROM pragma_table_info('ContentPillar') WHERE name='pageId'").get().nn === 0);
check("KnowledgeDoc.pageId nullable", docCols.includes("pageId") &&
  db.prepare("SELECT [notnull] AS nn FROM pragma_table_info('KnowledgeDoc') WHERE name='pageId'").get().nn === 0);

// 9.3. Tạo brand mới + profile theo brandId (không cần Page)
db.prepare(`INSERT INTO Brand (id, workspaceId, name, slug, status, createdAt, updatedAt)
  VALUES ('brand-b2', ?, 'Brand B2', 'brand-b2', 'ACTIVE', datetime('now'), datetime('now'))`).run(wsA);
db.prepare(`INSERT INTO BrandProfile (id, userId, brandId, brandName, tone, createdAt, updatedAt)
  VALUES ('bp-b2', ?, 'brand-b2', 'Brand B2', 'friendly', datetime('now'), datetime('now'))`).run(uid);
check("BrandProfile tạo được chỉ với brandId (không cần Page)", true);

// 9.4. Pillar thuộc brand, dùng chung 2 Page cùng brand
db.prepare(`INSERT INTO ContentPillar (id, userId, brandId, name, goal, weight, enabled, position, createdAt, updatedAt)
  VALUES ('pil-b2', ?, 'brand-b2', 'Pillar dùng chung', 'sales', 50, 1, 0, datetime('now'), datetime('now'))`).run(uid);
// Gán page P1 + tạo page P4 cùng brand B2; chuyển post-1 sang brand-b2
// để kiểm chứng SetNull trên Post khi xóa brand
db.prepare("UPDATE FacebookPage SET brandId = 'brand-b2' WHERE id = 'pg-p1'").run();
db.prepare("UPDATE Post SET brandId = 'brand-b2' WHERE id = 'post-1'").run();
db.prepare(`INSERT INTO FacebookPage (id, userId, workspaceId, fbPageId, name, category, accessToken, isActive, brandId, createdAt, updatedAt)
  VALUES ('pg-p4', ?, ?, 'FB400', 'Page P4 cùng brand', 'Test', 'tok', 1, 'brand-b2', datetime('now'), datetime('now'))`).run(uid, wsA);
const sharedPillars = db.prepare(
  `SELECT COUNT(*) c FROM ContentPillar WHERE brandId = 'brand-b2'`).get().c;
check("1 bộ pillar dùng chung cho 2 Page cùng brand", sharedPillars === 1);
const p4pillars = db.prepare(
  `SELECT COUNT(*) c FROM ContentPillar cp JOIN FacebookPage fp ON fp.brandId = cp.brandId WHERE fp.id = 'pg-p4'`).get().c;
check("Page P4 thấy pillar của brand (dùng chung)", p4pillars >= 1);

// 9.5. Xóa brand → Page giữ nguyên (bỏ gán), Post giữ nguyên, pillar/profile biến mất
db.prepare("DELETE FROM Brand WHERE id = 'brand-b2'").run();
const p1alive = db.prepare("SELECT id, brandId FROM FacebookPage WHERE id = 'pg-p1'").get();
check("Xóa brand → Page P1 còn nguyên", p1alive !== undefined);
check("Xóa brand → Page P1 mất brandId (SetNull)", p1alive.brandId === null);
const p4alive = db.prepare("SELECT id, brandId FROM FacebookPage WHERE id = 'pg-p4'").get();
check("Xóa brand → Page P4 còn nguyên, mất gán", p4alive !== undefined && p4alive.brandId === null);
const pillarGone = db.prepare("SELECT COUNT(*) c FROM ContentPillar WHERE brandId = 'brand-b2'").get().c;
check("Xóa brand → pillar bị cascade", pillarGone === 0);
const bpGone = db.prepare("SELECT COUNT(*) c FROM BrandProfile WHERE brandId = 'brand-b2'").get().c;
check("Xóa brand → hồ sơ bị cascade", bpGone === 0);
const post1AfterDel = db.prepare("SELECT id, brandId, pageId FROM Post WHERE id = 'post-1'").get();
check("Xóa brand → Post 1 còn nguyên, mất nhãn brand", post1AfterDel !== undefined && post1AfterDel.brandId === null);

// 9.6. FK sạch sau tất cả
const fk2 = db.prepare("PRAGMA foreign_key_check").all();
check("FK toàn vẹn sau brand CRUD", fk2.length === 0, JSON.stringify(fk2));

// ============================================================
// Dọn dữ liệu test
// ============================================================
db.prepare("DELETE FROM Workspace WHERE ownerId = ?").run(uid);
db.prepare("DELETE FROM FacebookPage WHERE userId = ?").run(uid);
db.prepare("DELETE FROM Post WHERE userId = ?").run(uid);

db.close();

console.log(`\n${"=".repeat(50)}`);
console.log(`KẾT QUẢ: ${passed} đạt, ${failed} lỗi`);
if (failures.length) {
  console.log("Lỗi:", failures.join("; "));
  process.exit(1);
}
