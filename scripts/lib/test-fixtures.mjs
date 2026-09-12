// ============================================================
// Test fixtures dùng chung cho các script E2E.
//
// Schema đa workspace + đa brand yêu cầu các ràng buộc NOT NULL:
//   - FacebookPage.workspaceId (bắt buộc)
//   - Post.workspaceId (bắt buộc)
//   - ContentPillar.brandId / KnowledgeDoc.brandId (bắt buộc)
//
// Các hàm ở đây idempotent (chạy lại không lỗi) và trả về ID để
// script seed tiếp các bảng con.
// ============================================================

import { randomUUID } from "node:crypto";

/** Workspace dùng chung cho test — tạo nếu chưa có, trả về id. */
export function ensureWorkspace(db, userId) {
  const wsId = `ws-e2e-${userId}`;
  const exists = db.prepare('SELECT id FROM "Workspace" WHERE id = ?').get(wsId);
  if (exists) return wsId;
  db.prepare(
    `INSERT INTO "Workspace" (id, name, slug, timezone, status, "ownerId", "createdAt", "updatedAt")
     VALUES (?, 'E2E Workspace', 'e2e-workspace', 'Asia/Ho_Chi_Minh', 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(wsId, userId);
  db.prepare(
    `INSERT INTO "WorkspaceMember" (id, "workspaceId", "userId", role, "createdAt")
     VALUES (?, ?, ?, 'OWNER', CURRENT_TIMESTAMP)`
  ).run(`wsm-${randomUUID()}`, wsId, userId);
  return wsId;
}

/** Facebook connection mặc định cho workspace test. */
export function ensureConnection(db, workspaceId, userId) {
  const appId = "e2e-app";
  const existing = db
    .prepare('SELECT id FROM "FacebookConnection" WHERE "workspaceId" = ? AND "appId" = ?')
    .get(workspaceId, appId);
  if (existing) return existing.id;
  const id = `fbc-${randomUUID()}`;
  db.prepare(
    `INSERT INTO "FacebookConnection" (id, "workspaceId", name, "appId", "appSecret", "userAccessToken",
      "graphVersion", status, "createdAt", "updatedAt", "createdById")
     VALUES (?, ?, 'E2E App', ?, 'secret', NULL, 'v21.0', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)`
  ).run(id, workspaceId, appId, userId);
  return id;
}

/** Brand test — trả về id; tạo mới nếu tên chưa tồn tại trong workspace. */
export function ensureBrand(db, workspaceId, userId, name = "E2E Brand") {
  const slug =
    name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "brand";
  const existing = db
    .prepare('SELECT id FROM "Brand" WHERE "workspaceId" = ? AND slug = ?')
    .get(workspaceId, slug);
  if (existing) return existing.id;
  const id = `brand-${randomUUID()}`;
  db.prepare(
    `INSERT INTO "Brand" (id, "workspaceId", name, slug, status, description, "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'ACTIVE', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(id, workspaceId, name, slug);
  return id;
}

/**
 * Seed một FacebookPage thuộc workspace + brand.
 * Trả về id của page vừa tạo/upsert.
 */
export function seedPage(
  db,
  { id, userId, workspaceId, brandId = null, connectionId = null, fbPageId, name, category = "Test", accessToken = "token" }
) {
  db.prepare('DELETE FROM "FacebookPage" WHERE "fbPageId" = ? AND "workspaceId" = ?').run(fbPageId, workspaceId);
  db.prepare(
    `INSERT INTO "FacebookPage" (id, "userId", "workspaceId", "fbPageId", name, category, "accessToken",
      "isActive", "brandId", "connectionId", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(id, userId, workspaceId, fbPageId, name, category, accessToken, brandId, connectionId);
  return id;
}
