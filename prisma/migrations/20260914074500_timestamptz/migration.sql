-- Chuyển 45 cột mốc thời gian sang TIMESTAMPTZ(3).
--
-- VÌ SAO CẦN
-- Các cột đang là `timestamp without time zone`, và giá trị được ghi bằng
-- GIỜ TƯỜNG Việt Nam (bộ lập kế hoạch tính slot bằng giờ local). Vấn đề:
-- phép so sánh trong SQL dùng múi giờ của TIẾN TRÌNH đang chạy.
--   - Máy dev (UTC+7): ghi `2026-09-14 08:18:00`, so với now() = 14:38  → đến hạn
--   - Vercel (UTC)   : so `08:18` với now() = 07:37 → CHƯA đến hạn (lệch 7 tiếng)
-- Hệ quả: mọi bài hẹn đăng bị trễ đúng 7 tiếng, và bài quá hạn vẫn nằm im.
--
-- TIMESTAMPTZ lưu một MỐC TUYỆT ĐỐI, nên ghi/đọc/so sánh đều giống nhau ở
-- mọi múi giờ tiến trình — không còn phụ thuộc cấu hình TZ của nơi triển khai.
--
-- CÁCH DIỄN GIẢI DỮ LIỆU CŨ
-- `USING <col> AT TIME ZONE 'Asia/Ho_Chi_Minh'` nói rõ: các giá trị đang có
-- LÀ giờ Việt Nam (đúng như chúng được ghi ra), KHÔNG phải UTC. Nếu bỏ mệnh đề
-- USING, Postgres sẽ hiểu theo timezone của session và lệch thêm 7 tiếng.
--
-- Ghi chú: cột `updatedAt` của vài dòng AppSetting từng được cron trên Vercel
-- ghi (giờ UTC) nên có thể lệch 7 tiếng — chỉ là metadata hiển thị, không ảnh
-- hưởng lịch đăng bài.

ALTER TABLE "AppSetting" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "AppSetting" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "AutoPilot" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "AutoPilot" ALTER COLUMN "lastPlannedAt" TYPE TIMESTAMPTZ(3) USING "lastPlannedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "AutoPilot" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Brand" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Brand" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "BrandProfile" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "BrandProfile" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "ContentPillar" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "ContentPillar" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Doc" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Doc" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FacebookConnection" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FacebookConnection" ALTER COLUMN "lastSyncedAt" TYPE TIMESTAMPTZ(3) USING "lastSyncedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FacebookConnection" ALTER COLUMN "lastValidatedAt" TYPE TIMESTAMPTZ(3) USING "lastValidatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FacebookConnection" ALTER COLUMN "tokenExpiresAt" TYPE TIMESTAMPTZ(3) USING "tokenExpiresAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FacebookConnection" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FacebookPage" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FacebookPage" ALTER COLUMN "tokenExpiresAt" TYPE TIMESTAMPTZ(3) USING "tokenExpiresAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FacebookPage" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FeedbackAnswer" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FeedbackAnswer" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FeedbackQuestion" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "FeedbackQuestion" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "KnowledgeDoc" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "KnowledgeDoc" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Media" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Notification" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Post" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Post" ALTER COLUMN "lastAttemptAt" TYPE TIMESTAMPTZ(3) USING "lastAttemptAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Post" ALTER COLUMN "lockedAt" TYPE TIMESTAMPTZ(3) USING "lockedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Post" ALTER COLUMN "nextAttemptAt" TYPE TIMESTAMPTZ(3) USING "nextAttemptAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Post" ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(3) USING "publishedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Post" ALTER COLUMN "scheduledAt" TYPE TIMESTAMPTZ(3) USING "scheduledAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Post" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "UsedMedia" ALTER COLUMN "usedAt" TYPE TIMESTAMPTZ(3) USING "usedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "User" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "User" ALTER COLUMN "passwordChangedAt" TYPE TIMESTAMPTZ(3) USING "passwordChangedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "User" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "UserSetting" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "UserSetting" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Workspace" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "Workspace" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
ALTER TABLE "WorkspaceMember" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'Asia/Ho_Chi_Minh';
