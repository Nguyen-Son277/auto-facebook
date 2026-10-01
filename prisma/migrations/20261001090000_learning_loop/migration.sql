-- VÒNG HỌC KHÉP KÍN — đăng → thu số liệu → chấm → điều chỉnh → kiểm chứng → giữ/rollback.
--
-- Mọi cột thêm vào bảng cũ đều nullable hoặc có DEFAULT: dữ liệu hiện có không
-- đổi hành vi, Page chưa bật insightsEnabled vẫn lập kế hoạch y như trước.

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "hookStyle" TEXT;

-- AlterTable
ALTER TABLE "AutoPilot" ADD COLUMN "explorationRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ProbeEntry" ADD COLUMN "postIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "LearningSnapshot" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "medianScore" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "explorationRate" DOUBLE PRECISION NOT NULL,
    "summary" TEXT,

    CONSTRAINT "LearningSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningAdjustment" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "baselineMedian" DOUBLE PRECISION NOT NULL,
    "baselineSamples" INTEGER NOT NULL,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL,
    "evaluateAfter" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "resultMedian" DOUBLE PRECISION,
    "resultSamples" INTEGER,
    "lockedUntil" TIMESTAMPTZ(3),
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LearningAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningSnapshot_pageId_dayKey_key" ON "LearningSnapshot"("pageId", "dayKey");
CREATE INDEX "LearningSnapshot_pageId_at_idx" ON "LearningSnapshot"("pageId", "at");
CREATE INDEX "LearningAdjustment_pageId_status_idx" ON "LearningAdjustment"("pageId", "status");
CREATE INDEX "LearningAdjustment_pageId_kind_appliedAt_idx" ON "LearningAdjustment"("pageId", "kind", "appliedAt");

-- AddForeignKey
ALTER TABLE "LearningSnapshot" ADD CONSTRAINT "LearningSnapshot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningAdjustment" ADD CONSTRAINT "LearningAdjustment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
