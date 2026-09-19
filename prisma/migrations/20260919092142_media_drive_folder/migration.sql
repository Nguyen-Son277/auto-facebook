-- Thư mục Drive chứa tệp — để AutoPilot lọc ảnh theo thương hiệu.
--
-- VÌ SAO CẦN
-- Khi người dùng gắn cả một thư mục Drive, ta đồng bộ nội dung thư mục thành bản
-- ghi Media (nguồn DRIVE). AutoPilot cần biết tệp nào thuộc thư mục của thương
-- hiệu đang xét — nếu không có cột này thì mọi ảnh Drive của user bị trộn lẫn
-- giữa các thương hiệu, và mỗi lần lập kế hoạch lại phải gọi Drive.
--
-- Cột nullable nên mọi dữ liệu hiện có không bị ảnh hưởng.

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "driveFolderId" TEXT;
