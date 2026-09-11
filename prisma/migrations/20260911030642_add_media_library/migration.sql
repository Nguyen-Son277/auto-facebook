-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Media" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT,
    "userId" TEXT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Media_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Media_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Media" ("createdAt", "duration", "height", "id", "position", "postId", "previewUrl", "remoteUrl", "source", "type", "width") SELECT "createdAt", "duration", "height", "id", "position", "postId", "previewUrl", "remoteUrl", "source", "type", "width" FROM "Media";
DROP TABLE "Media";
ALTER TABLE "new_Media" RENAME TO "Media";
CREATE INDEX "Media_userId_idx" ON "Media"("userId");
CREATE INDEX "Media_postId_idx" ON "Media"("postId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
