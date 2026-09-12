-- ============================================================
-- BRAND CONTENT DECOUPLED
--
-- Nội dung thương hiệu tách khỏi Page:
-- - BrandProfile: BỎ cột pageId (hồ sơ 1-1 với Brand qua brandId).
-- - ContentPillar / KnowledgeDoc: pageId -> NULLABLE (giữ cho dữ liệu cũ,
--   nội dung giờ thuộc Brand, dùng chung mọi Page của thương hiệu).
-- - FacebookPage: bỏ quan hệ ngược brandProfile (đã không tồn tại).
--
-- Copy nguyên vẹn mọi dòng — các dòng đã có brandId từ migration trước.
-- ============================================================

PRAGMA foreign_keys=OFF;

-- ---------- BrandProfile: bỏ pageId ----------
CREATE TABLE "new_BrandProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
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
    CONSTRAINT "BrandProfile_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BrandProfile" SELECT
    "id", "userId", "brandId", "brandName", "tagline", "description", "industry",
    "products", "usp", "priceRange", "audience", "address", "phone", "website",
    "tone", "avoidTopics", "signatureCta", "baseHashtags", "samplePosts", "notes",
    "createdAt", "updatedAt"
FROM "BrandProfile";
DROP TABLE "BrandProfile";
ALTER TABLE "new_BrandProfile" RENAME TO "BrandProfile";
CREATE UNIQUE INDEX "BrandProfile_brandId_key" ON "BrandProfile"("brandId");

-- ---------- ContentPillar: pageId nullable ----------
CREATE TABLE "new_ContentPillar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "pageId" TEXT,
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
    CONSTRAINT "ContentPillar_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ContentPillar" SELECT
    "id", "userId", "brandId", "pageId", "name", "description", "goal",
    "weight", "enabled", "position", "createdAt", "updatedAt"
FROM "ContentPillar";
DROP TABLE "ContentPillar";
ALTER TABLE "new_ContentPillar" RENAME TO "ContentPillar";
CREATE INDEX "ContentPillar_pageId_idx" ON "ContentPillar"("pageId");
CREATE INDEX "ContentPillar_brandId_enabled_idx" ON "ContentPillar"("brandId", "enabled");

-- ---------- KnowledgeDoc: pageId nullable ----------
CREATE TABLE "new_KnowledgeDoc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "pageId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeDoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_KnowledgeDoc" SELECT
    "id", "userId", "brandId", "pageId", "title", "kind", "content", "enabled",
    "createdAt", "updatedAt"
FROM "KnowledgeDoc";
DROP TABLE "KnowledgeDoc";
ALTER TABLE "new_KnowledgeDoc" RENAME TO "KnowledgeDoc";
CREATE INDEX "KnowledgeDoc_pageId_idx" ON "KnowledgeDoc"("pageId");
CREATE INDEX "KnowledgeDoc_brandId_enabled_idx" ON "KnowledgeDoc"("brandId", "enabled");

PRAGMA foreign_keys=ON;
