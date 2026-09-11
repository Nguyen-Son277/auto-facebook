-- AlterTable
ALTER TABLE "Post" ADD COLUMN "hook" TEXT;

-- CreateTable
CREATE TABLE "UsedMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsedMedia_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AutoPilot" (
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
    "mediaMix" TEXT NOT NULL DEFAULT 'IMAGE_ONLY',
    "videoPercent" INTEGER NOT NULL DEFAULT 25,
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
INSERT INTO "new_AutoPilot" ("autoMedia", "createdAt", "daysOfWeek", "enabled", "id", "lastPlanCount", "lastPlanError", "lastPlannedAt", "length", "mediaKind", "minGapMinutes", "mode", "pageId", "photosPerPost", "planAheadDays", "postsPerDay", "toneOverride", "totalPlanned", "updatedAt", "useHashtags", "userId", "windowEnd", "windowStart") SELECT "autoMedia", "createdAt", "daysOfWeek", "enabled", "id", "lastPlanCount", "lastPlanError", "lastPlannedAt", "length", "mediaKind", "minGapMinutes", "mode", "pageId", "photosPerPost", "planAheadDays", "postsPerDay", "toneOverride", "totalPlanned", "updatedAt", "useHashtags", "userId", "windowEnd", "windowStart" FROM "AutoPilot";
DROP TABLE "AutoPilot";
ALTER TABLE "new_AutoPilot" RENAME TO "AutoPilot";
CREATE UNIQUE INDEX "AutoPilot_pageId_key" ON "AutoPilot"("pageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "UsedMedia_pageId_usedAt_idx" ON "UsedMedia"("pageId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsedMedia_pageId_providerId_key" ON "UsedMedia"("pageId", "providerId");
