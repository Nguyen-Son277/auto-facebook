-- NGUỒN MEDIA THỨ BA: Google Drive cá nhân.
--
-- VÌ SAO CẦN
-- Ảnh/video hiện dồn vào Supabase Storage (1 GB ở gói Free). Thêm Drive cá
-- nhân làm nguồn thứ ba, ngang hàng với Pexels và "tải từ máy": mỗi người
-- dùng dùng 15 GB của chính họ, dung lượng tăng theo số người dùng thay vì
-- đè lên hạn mức của hệ thống.
--
-- DriveConnection: token OAuth của từng người dùng (mã hóa AES-256-GCM ở
-- tầng ứng dụng, giống FacebookConnection).
-- BrandDriveFolder: thư mục Drive của từng thương hiệu — scope "drive.file"
-- chỉ thấy file do app tạo hoặc do người dùng chọn qua Google Picker, nên
-- mỗi Brand phải có một thư mục được chọn tường minh.
--
-- AutoPilot: người dùng chọn nguồn chính (mediaPrimary) và có bật dự phòng
-- sang nguồn còn lại không (mediaFallback). Mặc định PEXELS/true = giữ
-- nguyên hành vi cũ cho mọi cấu hình đang có.

-- AlterTable
ALTER TABLE "AutoPilot" ADD COLUMN     "mediaFallback" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "mediaPrimary" TEXT NOT NULL DEFAULT 'PEXELS';

-- CreateTable
CREATE TABLE "DriveConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "scope" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "rootFolderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastRefreshedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandDriveFolder" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "connectionId" TEXT,
    "folderId" TEXT NOT NULL,
    "folderName" TEXT,
    "allowVideo" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BrandDriveFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveConnection_userId_key" ON "DriveConnection"("userId");

-- CreateIndex
CREATE INDEX "DriveConnection_status_idx" ON "DriveConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BrandDriveFolder_brandId_key" ON "BrandDriveFolder"("brandId");

-- CreateIndex
CREATE INDEX "BrandDriveFolder_connectionId_idx" ON "BrandDriveFolder"("connectionId");

-- AddForeignKey
ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandDriveFolder" ADD CONSTRAINT "BrandDriveFolder_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandDriveFolder" ADD CONSTRAINT "BrandDriveFolder_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "DriveConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
