-- ============================================================
-- MULTI-WORKSPACE TENANTS
--
-- Thêm Workspace, WorkspaceMember, FacebookConnection (nhiều Facebook
-- Graph API App mỗi workspace) và Brand (nhiều thương hiệu mỗi workspace).
--
-- Backfill an toàn cho dữ liệu hiện có:
-- 1. Mỗi User -> 1 Workspace mặc định + WorkspaceMember OWNER.
-- 2. Cấu hình Facebook toàn cục (AppSetting facebook.*) -> 1
--    FacebookConnection mặc định trong workspace (giá trị đã mã hóa
--    AES-256-GCM copy nguyên vẹn — cùng khóa derive).
-- 3. Mỗi BrandProfile hiện có -> 1 Brand; Page gắn brand đó.
-- 4. FacebookPage/Post/Media/ContentPillar/KnowledgeDoc được gán
--    workspaceId (và brandId khi suy ra được).
--
-- KHÔNG xóa key facebook.* trong AppSetting — giữ fallback cho code
-- cũ cho đến khi mọi luồng chuyển sang FacebookConnection.
-- ============================================================

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FacebookConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "appSecret" TEXT NOT NULL,
    "userAccessToken" TEXT NOT NULL,
    "graphVersion" TEXT NOT NULL DEFAULT 'v21.0',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "tokenExpiresAt" DATETIME,
    "lastValidatedAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FacebookConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FacebookConnection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Brand_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");
CREATE INDEX "FacebookConnection_workspaceId_status_idx" ON "FacebookConnection"("workspaceId", "status");
CREATE UNIQUE INDEX "FacebookConnection_workspaceId_appId_key" ON "FacebookConnection"("workspaceId", "appId");
CREATE INDEX "Brand_workspaceId_status_idx" ON "Brand"("workspaceId", "status");
CREATE UNIQUE INDEX "Brand_workspaceId_slug_key" ON "Brand"("workspaceId", "slug");

-- ============================================================
-- BACKFILL 1: mỗi User một workspace mặc định + membership OWNER
-- ============================================================
INSERT INTO "Workspace" ("id", "name", "slug", "ownerId", "updatedAt")
SELECT
  'ws-' || "id",
  COALESCE("name", "email"),
  lower(replace("email", '@', '-at-')),
  "id",
  datetime('now')
FROM "User";

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role")
SELECT
  'wm-' || "id",
  'ws-' || "id",
  "id",
  'OWNER'
FROM "User";

-- ============================================================
-- BACKFILL 2: FacebookConnection mặc định từ AppSetting facebook.*
-- (giá trị value đã mã hóa AES-256-GCM — copy nguyên vẹn, cùng khóa)
-- ============================================================
INSERT INTO "FacebookConnection" (
  "id", "workspaceId", "name", "appId", "appSecret", "userAccessToken",
  "graphVersion", "status", "tokenExpiresAt", "createdById", "updatedAt"
)
SELECT
  'fbc-' || u."id",
  'ws-' || u."id",
  'Facebook App mặc định',
  COALESCE((SELECT value FROM "AppSetting" WHERE key = 'facebook.appId'), ''),
  COALESCE((SELECT value FROM "AppSetting" WHERE key = 'facebook.appSecret'), ''),
  COALESCE((SELECT value FROM "AppSetting" WHERE key = 'facebook.userToken'), ''),
  COALESCE((SELECT value FROM "AppSetting" WHERE key = 'facebook.graphVersion'), 'v21.0'),
  'ACTIVE',
  CASE
    WHEN (SELECT value FROM "AppSetting" WHERE key = 'facebook.userTokenExpiresAt') IS NOT NULL
      AND CAST((SELECT value FROM "AppSetting" WHERE key = 'facebook.userTokenExpiresAt') AS INTEGER) > 0
    THEN datetime(CAST((SELECT value FROM "AppSetting" WHERE key = 'facebook.userTokenExpiresAt') AS INTEGER) / 1000, 'unixepoch')
    ELSE NULL
  END,
  u."id",
  datetime('now')
FROM "User" u;

-- ============================================================
-- BACKFILL 3: Brand từ BrandProfile (mỗi hồ sơ 1 brand)
-- ============================================================
INSERT INTO "Brand" ("id", "workspaceId", "name", "slug", "description", "updatedAt")
SELECT
  'brand-' || bp."id",
  'ws-' || bp."userId",
  COALESCE(bp."brandName", fp."name", 'Thương hiệu'),
  'b-' || bp."id",
  bp."description",
  datetime('now')
FROM "BrandProfile" bp
JOIN "FacebookPage" fp ON fp."id" = bp."pageId";

-- ============================================================
-- REDEFINE FacebookPage: + workspaceId/connectionId/brandId
--
-- QUAN TRỌNG: tắt foreign_keys HOÀN TOÀN trước khi copy dữ liệu sang
-- bảng mới rồi DROP bảng cũ. Nếu dùng defer_foreign_keys, DROP bảng
-- cha (FacebookPage/Post) sẽ XÓA MẤT các dòng con (Post/Media) khi
-- PRAGMA foreign_keys=ON chạy cuối file — mất dữ liệu thật.
-- ============================================================
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_FacebookPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "connectionId" TEXT,
    "brandId" TEXT,
    "fbPageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "avatarUrl" TEXT,
    "accessToken" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FacebookPage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FacebookPage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FacebookPage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "FacebookConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FacebookPage_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_FacebookPage" (
  "id", "userId", "workspaceId", "connectionId", "brandId",
  "fbPageId", "name", "category", "avatarUrl", "accessToken",
  "tokenExpiresAt", "isActive", "createdAt", "updatedAt"
)
SELECT
  p."id",
  p."userId",
  'ws-' || p."userId",
  (SELECT c."id" FROM "FacebookConnection" c WHERE c."workspaceId" = 'ws-' || p."userId" LIMIT 1),
  (SELECT 'brand-' || bp."id" FROM "BrandProfile" bp WHERE bp."pageId" = p."id" LIMIT 1),
  p."fbPageId", p."name", p."category", p."avatarUrl", p."accessToken",
  p."tokenExpiresAt", p."isActive", p."createdAt", p."updatedAt"
FROM "FacebookPage" p;
DROP TABLE "FacebookPage";
ALTER TABLE "new_FacebookPage" RENAME TO "FacebookPage";
CREATE INDEX "FacebookPage_connectionId_idx" ON "FacebookPage"("connectionId");
CREATE INDEX "FacebookPage_workspaceId_brandId_idx" ON "FacebookPage"("workspaceId", "brandId");
CREATE UNIQUE INDEX "FacebookPage_workspaceId_fbPageId_key" ON "FacebookPage"("workspaceId", "fbPageId");

-- ============================================================
-- REDEFINE BrandProfile: + brandId (1-1 với Brand)
-- ============================================================
CREATE TABLE "new_BrandProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "brandName" TEXT,
    "tagline" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "products" TEXT,
    "usp" TEXT,
    "priceRange" TEXT,
    "audience" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "avoidTopics" TEXT,
    "signatureCta" TEXT,
    "baseHashtags" TEXT,
    "samplePosts" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandProfile_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BrandProfile_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BrandProfile" (
  "id", "userId", "brandId", "pageId",
  "brandName", "tagline", "description", "industry", "products", "usp",
  "priceRange", "audience", "address", "phone", "website", "tone",
  "avoidTopics", "signatureCta", "baseHashtags", "samplePosts", "notes",
  "createdAt", "updatedAt"
)
SELECT
  bp."id", bp."userId",
  'brand-' || bp."id",
  bp."pageId",
  bp."brandName", bp."tagline", bp."description", bp."industry", bp."products", bp."usp",
  bp."priceRange", bp."audience", bp."address", bp."phone", bp."website", bp."tone",
  bp."avoidTopics", bp."signatureCta", bp."baseHashtags", bp."samplePosts", bp."notes",
  bp."createdAt", bp."updatedAt"
FROM "BrandProfile" bp;
DROP TABLE "BrandProfile";
ALTER TABLE "new_BrandProfile" RENAME TO "BrandProfile";
CREATE UNIQUE INDEX "BrandProfile_brandId_key" ON "BrandProfile"("brandId");
CREATE UNIQUE INDEX "BrandProfile_pageId_key" ON "BrandProfile"("pageId");

-- ============================================================
-- REDEFINE ContentPillar: + brandId (qua page -> BrandProfile)
-- ============================================================
CREATE TABLE "new_ContentPillar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "goal" TEXT NOT NULL DEFAULT 'engagement',
    "weight" INTEGER NOT NULL DEFAULT 25,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContentPillar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentPillar_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContentPillar_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContentPillar" (
  "id", "userId", "brandId", "pageId",
  "name", "description", "goal", "weight", "enabled", "position",
  "createdAt", "updatedAt"
)
SELECT
  cp."id", cp."userId",
  COALESCE(
    (SELECT 'brand-' || bp."id" FROM "BrandProfile" bp WHERE bp."pageId" = cp."pageId" LIMIT 1),
    (SELECT b."id" FROM "Brand" b WHERE b."workspaceId" = 'ws-' || cp."userId" LIMIT 1)
  ),
  cp."pageId",
  cp."name", cp."description", cp."goal", cp."weight", cp."enabled", cp."position",
  cp."createdAt", cp."updatedAt"
FROM "ContentPillar" cp;
DROP TABLE "ContentPillar";
ALTER TABLE "new_ContentPillar" RENAME TO "ContentPillar";
CREATE INDEX "ContentPillar_pageId_enabled_idx" ON "ContentPillar"("pageId", "enabled");
CREATE INDEX "ContentPillar_brandId_enabled_idx" ON "ContentPillar"("brandId", "enabled");

-- ============================================================
-- REDEFINE KnowledgeDoc: + brandId (qua page -> BrandProfile)
-- ============================================================
CREATE TABLE "new_KnowledgeDoc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeDoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_KnowledgeDoc" (
  "id", "userId", "brandId", "pageId",
  "title", "kind", "content", "enabled", "createdAt", "updatedAt"
)
SELECT
  kd."id", kd."userId",
  COALESCE(
    (SELECT 'brand-' || bp."id" FROM "BrandProfile" bp WHERE bp."pageId" = kd."pageId" LIMIT 1),
    (SELECT b."id" FROM "Brand" b WHERE b."workspaceId" = 'ws-' || kd."userId" LIMIT 1)
  ),
  kd."pageId",
  kd."title", kd."kind", kd."content", kd."enabled", kd."createdAt", kd."updatedAt"
FROM "KnowledgeDoc" kd;
DROP TABLE "KnowledgeDoc";
ALTER TABLE "new_KnowledgeDoc" RENAME TO "KnowledgeDoc";
CREATE INDEX "KnowledgeDoc_pageId_enabled_idx" ON "KnowledgeDoc"("pageId", "enabled");
CREATE INDEX "KnowledgeDoc_brandId_enabled_idx" ON "KnowledgeDoc"("brandId", "enabled");

-- ============================================================
-- REDEFINE Post: + workspaceId (qua user) + brandId (qua page)
-- ============================================================
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT,
    "pageId" TEXT,
    "content" TEXT NOT NULL,
    "hook" TEXT,
    "hashtags" TEXT,
    "linkUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "errorMessage" TEXT,
    "fbPostId" TEXT,
    "scheduledAt" DATETIME,
    "publishedAt" DATETIME,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "pillarName" TEXT,
    "topic" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "nextAttemptAt" DATETIME,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Post_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Post_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Post_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Post" (
  "id", "userId", "workspaceId", "brandId", "pageId",
  "content", "hook", "hashtags", "linkUrl", "status", "errorMessage",
  "fbPostId", "scheduledAt", "publishedAt", "origin", "pillarName", "topic",
  "attempts", "lastAttemptAt", "nextAttemptAt", "lockedAt", "createdAt", "updatedAt"
)
SELECT
  p."id", p."userId",
  'ws-' || p."userId",
  (SELECT fp."brandId" FROM "FacebookPage" fp WHERE fp."id" = p."pageId" LIMIT 1),
  p."pageId",
  p."content", p."hook", p."hashtags", p."linkUrl", p."status", p."errorMessage",
  p."fbPostId", p."scheduledAt", p."publishedAt", p."origin", p."pillarName", p."topic",
  p."attempts", p."lastAttemptAt", p."nextAttemptAt", p."lockedAt", p."createdAt", p."updatedAt"
FROM "Post" p;
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");
CREATE INDEX "Post_status_nextAttemptAt_idx" ON "Post"("status", "nextAttemptAt");
CREATE INDEX "Post_pageId_origin_scheduledAt_idx" ON "Post"("pageId", "origin", "scheduledAt");
CREATE INDEX "Post_workspaceId_status_scheduledAt_idx" ON "Post"("workspaceId", "status", "scheduledAt");
CREATE INDEX "Post_workspaceId_brandId_idx" ON "Post"("workspaceId", "brandId");

-- ============================================================
-- REDEFINE Media: + workspaceId (qua post hoặc user)
-- ============================================================
CREATE TABLE "new_Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT,
    "userId" TEXT,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'PEXELS',
    "remoteUrl" TEXT NOT NULL,
    "previewUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "photographer" TEXT,
    "photographerUrl" TEXT,
    "sourcePageUrl" TEXT,
    "alt" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Media_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Media_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Media_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Media" (
  "id", "postId", "userId", "workspaceId",
  "type", "source", "remoteUrl", "previewUrl", "width", "height", "duration",
  "position", "providerId", "photographer", "photographerUrl", "sourcePageUrl",
  "alt", "storageKey", "mimeType", "sizeBytes", "createdAt"
)
SELECT
  m."id", m."postId", m."userId",
  COALESCE(
    (SELECT p."workspaceId" FROM "Post" p WHERE p."id" = m."postId" LIMIT 1),
    CASE WHEN m."userId" IS NOT NULL THEN 'ws-' || m."userId" ELSE NULL END
  ),
  m."type", m."source", m."remoteUrl", m."previewUrl", m."width", m."height", m."duration",
  m."position", m."providerId", m."photographer", m."photographerUrl", m."sourcePageUrl",
  m."alt", m."storageKey", m."mimeType", m."sizeBytes", m."createdAt"
FROM "Media" m;
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE INDEX "Media_userId_idx" ON "Media"("userId");
CREATE INDEX "Media_postId_idx" ON "Media"("postId");
CREATE INDEX "Media_workspaceId_idx" ON "Media"("workspaceId");

PRAGMA foreign_keys=ON;
