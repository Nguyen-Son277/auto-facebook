-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
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
    CONSTRAINT "BrandProfile_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentPillar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
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
    CONSTRAINT "ContentPillar_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeDoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutoPilot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'REVIEW',
    "postsPerDay" INTEGER NOT NULL DEFAULT 2,
    "windowStart" TEXT NOT NULL DEFAULT '07:00',
    "windowEnd" TEXT NOT NULL DEFAULT '21:00',
    "daysOfWeek" TEXT NOT NULL DEFAULT '1,2,3,4,5,6,7',
    "minGapMinutes" INTEGER NOT NULL DEFAULT 120,
    "autoMedia" BOOLEAN NOT NULL DEFAULT true,
    "mediaKind" TEXT NOT NULL DEFAULT 'IMAGE',
    "photosPerPost" INTEGER NOT NULL DEFAULT 2,
    "length" TEXT NOT NULL DEFAULT 'medium',
    "toneOverride" TEXT,
    "useHashtags" BOOLEAN NOT NULL DEFAULT true,
    "planAheadDays" INTEGER NOT NULL DEFAULT 2,
    "lastPlannedAt" DATETIME,
    "lastPlanError" TEXT,
    "lastPlanCount" INTEGER NOT NULL DEFAULT 0,
    "totalPlanned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutoPilot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutoPilot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "pageId" TEXT,
    "content" TEXT NOT NULL,
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
    CONSTRAINT "Post_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("attempts", "content", "createdAt", "errorMessage", "fbPostId", "hashtags", "id", "lastAttemptAt", "linkUrl", "lockedAt", "nextAttemptAt", "pageId", "publishedAt", "scheduledAt", "status", "updatedAt", "userId") SELECT "attempts", "content", "createdAt", "errorMessage", "fbPostId", "hashtags", "id", "lastAttemptAt", "linkUrl", "lockedAt", "nextAttemptAt", "pageId", "publishedAt", "scheduledAt", "status", "updatedAt", "userId" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");
CREATE INDEX "Post_status_nextAttemptAt_idx" ON "Post"("status", "nextAttemptAt");
CREATE INDEX "Post_pageId_origin_scheduledAt_idx" ON "Post"("pageId", "origin", "scheduledAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_pageId_key" ON "BrandProfile"("pageId");

-- CreateIndex
CREATE INDEX "ContentPillar_pageId_enabled_idx" ON "ContentPillar"("pageId", "enabled");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_pageId_enabled_idx" ON "KnowledgeDoc"("pageId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AutoPilot_pageId_key" ON "AutoPilot"("pageId");
