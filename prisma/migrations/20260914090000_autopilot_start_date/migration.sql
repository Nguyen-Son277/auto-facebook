-- Mốc neo lập kế hoạch cho chế độ tự động.
--
-- VÌ SAO CẦN
-- Bộ lập kế hoạch luôn tính từ HÔM NAY. Khi người dùng xoá bài đã lên lịch rồi
-- bật lại, họ không có cách nào nói "bắt đầu lại từ ngày X" — và những ngày đã
-- xoá có thể nằm ngoài tầm kế hoạch (planAheadDays) nên không bao giờ được trám.
--
-- `startDate` cho phép neo mốc bắt đầu. NULL = hôm nay, tức giữ nguyên hành vi
-- cũ nên mọi dữ liệu đang có không bị ảnh hưởng.
ALTER TABLE "AutoPilot" ADD COLUMN "startDate" TIMESTAMPTZ(3);
