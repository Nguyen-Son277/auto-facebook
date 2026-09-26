-- HỌC TỪ SỐ LIỆU BÀI ĐĂNG — tự tối ưu AutoPilot theo thời gian.
--
-- VÌ SAO CẦN
-- AutoPilot trước đây chỉ biết "đã đăng" chứ không biết bài có được người xem
-- hay không, nên nội dung dễ dậm chân tại chỗ: cùng trụ cột, cùng khung giờ,
-- cùng kiểu mở bài lặp mãi. Migration này thêm phần đọc số liệu thật của
-- Facebook rồi dùng nó để chọn hướng cho các bài sau.
--
-- Bốn việc được thêm:
--   1. PostInsight            — số liệu của TỪNG bài đã đăng.
--   2. PageInsightSnapshot    — số liệu cấp Page theo ngày (bối cảnh chung).
--   3. ProbeEntry             — nhật ký đợt "dò" khi chưa có số liệu để học.
--   4. ContentDirection       — nội dung đang triển khai theo hướng nào, ra sao.
--
-- NGUYÊN TẮC AN TOÀN (quan trọng — không được nới lỏng về sau)
--   * Mọi cột thêm vào bảng cũ đều có DEFAULT, nên dữ liệu hiện có không đổi
--     hành vi. Đặc biệt `AutoPilot.insightsEnabled` mặc định false: Page nào
--     không chủ động bật thì lập kế hoạch Y NHƯ TRƯỚC, không thêm lệnh gọi
--     Graph API nào.
--   * Tính năng chỉ đổi CÁCH triển khai (trụ cột, khung giờ, góc trình bày),
--     KHÔNG BAO GIỜ ghi đè hồ sơ thương hiệu hay trọng số trụ cột người dùng
--     đặt. Vì vậy không có cột nào ở đây sửa BrandProfile/ContentPillar.
--   * Số liệu phân phối (impressions/mediaView/videoViews/clicks) đều NULLABLE:
--     chúng cần quyền `read_insights` và Page phải đủ 100 lượt thích, còn
--     reactions/comments/shares thì luôn lấy được bằng `pages_read_engagement`.
--     Nhờ vậy tính năng vẫn chạy (kém chính xác hơn) khi thiếu quyền.

-- ============================================================
-- 1. Bật/tắt tối ưu theo số liệu + trạng thái vòng đời học
-- ============================================================

-- AlterTable
ALTER TABLE "AutoPilot" ADD COLUMN     "insightsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastReProbeAt" TIMESTAMPTZ(3),
ADD COLUMN     "learningComputedAt" TIMESTAMPTZ(3),
ADD COLUMN     "learningConclusion" TEXT,
ADD COLUMN     "learningPhase" TEXT NOT NULL DEFAULT 'PROBE',
ADD COLUMN     "probeRedistributed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "probeStartedAt" TIMESTAMPTZ(3);

-- ============================================================
-- 2. Trạng thái thu thập số liệu của từng Page
-- ============================================================

-- AlterTable
ALTER TABLE "FacebookPage" ADD COLUMN     "insightsLastError" TEXT,
ADD COLUMN     "insightsLastFetchedAt" TIMESTAMPTZ(3),
ADD COLUMN     "insightsStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- ============================================================
-- 3. Bài dò hay bài thường + vì sao bài này viết như vậy
-- ============================================================

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "optimizationNote" TEXT,
ADD COLUMN     "probeKind" TEXT NOT NULL DEFAULT 'STANDARD';

-- ============================================================
-- 4. Số liệu hiệu quả của từng bài
-- ============================================================

-- CreateTable
CREATE TABLE "PostInsight" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "fbPostId" TEXT NOT NULL,
    "impressions" INTEGER,
    "mediaView" INTEGER,
    "mediaViewUnique" INTEGER,
    "videoViews" INTEGER,
    "videoAvgTimeMs" INTEGER,
    "clicks" INTEGER,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "missingMetrics" TEXT,
    "errorMessage" TEXT,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PostInsight_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 5. Số liệu cấp Page theo ngày (dayKey = ngày theo giờ Việt Nam)
-- ============================================================

-- CreateTable
CREATE TABLE "PageInsightSnapshot" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "dayKey" TEXT NOT NULL,
    "fans" INTEGER,
    "follows" INTEGER,
    "pageImpressions" INTEGER,
    "mediaView" INTEGER,
    "mediaViewUnique" INTEGER,
    "postEngagements" INTEGER,
    "pageViewsTotal" INTEGER,
    "topCitiesJson" TEXT,
    "missingMetrics" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "errorMessage" TEXT,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PageInsightSnapshot_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 6. Nhật ký đợt dò tìm hướng đi ban đầu
-- ============================================================

-- CreateTable
CREATE TABLE "ProbeEntry" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "batchId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "result" TEXT NOT NULL DEFAULT 'PENDING',
    "score" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProbeEntry_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 7. Nội dung đang triển khai theo hướng nào — phần "nhận xét"
-- ============================================================

-- CreateTable
CREATE TABLE "ContentDirection" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXPLORING',
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION,
    "prevAvgScore" DOUBLE PRECISION,
    "changePct" DOUBLE PRECISION,
    "estLifeDays" INTEGER,
    "recommendation" TEXT,
    "lastEvaluatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContentDirection_pkey" PRIMARY KEY ("id")
);

-- ============================================================
-- 8. Chỉ mục & khoá ngoại
-- ============================================================

-- CreateIndex
CREATE UNIQUE INDEX "PostInsight_postId_key" ON "PostInsight"("postId");

-- CreateIndex
CREATE INDEX "PostInsight_pageId_fetchedAt_idx" ON "PostInsight"("pageId", "fetchedAt");

-- CreateIndex
CREATE INDEX "PostInsight_workspaceId_idx" ON "PostInsight"("workspaceId");

-- CreateIndex
CREATE INDEX "PostInsight_pageId_status_idx" ON "PostInsight"("pageId", "status");

-- CreateIndex
CREATE INDEX "PageInsightSnapshot_pageId_fetchedAt_idx" ON "PageInsightSnapshot"("pageId", "fetchedAt");

-- CreateIndex
CREATE INDEX "PageInsightSnapshot_workspaceId_idx" ON "PageInsightSnapshot"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PageInsightSnapshot_pageId_dayKey_key" ON "PageInsightSnapshot"("pageId", "dayKey");

-- CreateIndex
CREATE INDEX "ProbeEntry_pageId_createdAt_idx" ON "ProbeEntry"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "ProbeEntry_workspaceId_idx" ON "ProbeEntry"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProbeEntry_pageId_batchId_kind_value_key" ON "ProbeEntry"("pageId", "batchId", "kind", "value");

-- CreateIndex
CREATE INDEX "ContentDirection_pageId_status_idx" ON "ContentDirection"("pageId", "status");

-- CreateIndex
CREATE INDEX "ContentDirection_workspaceId_idx" ON "ContentDirection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentDirection_pageId_kind_value_key" ON "ContentDirection"("pageId", "kind", "value");

-- CreateIndex
-- Đếm bài AutoPilot đã đăng của một Page — dùng để suy ra giai đoạn học
-- (PROBE khi còn ít bài, EXPLOIT khi đã đủ mẫu) mà không phải quét bảng.
CREATE INDEX "Post_pageId_origin_status_publishedAt_idx" ON "Post"("pageId", "origin", "status", "publishedAt");

-- AddForeignKey
ALTER TABLE "PostInsight" ADD CONSTRAINT "PostInsight_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostInsight" ADD CONSTRAINT "PostInsight_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageInsightSnapshot" ADD CONSTRAINT "PageInsightSnapshot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbeEntry" ADD CONSTRAINT "ProbeEntry_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentDirection" ADD CONSTRAINT "ContentDirection_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "FacebookPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
