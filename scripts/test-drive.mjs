// ============================================================
// Kiểm thử phần THUẦN của tích hợp Google Drive (src/lib/drive-files.ts).
//
// Chạy: npm run test:drive
//
// Không cần Google thật, không cần database. Phần gọi mạng được kiểm bằng
// mock server + e2e (scripts/mock-drive-server.mjs, scripts/e2e-drive.mjs).
// ============================================================

import {
  IMAGE_MIMES,
  VIDEO_MIMES,
  extensionForMime,
  isGoogleNative,
  isImageMime,
  isSupportedMime,
  isVideoMime,
  mapDriveFile,
  mapDriveFiles,
  mediaKindFromMime,
  safeFileName,
} from "../src/lib/drive-files.ts";
import { parseDriveFileLink, parseDriveFolderLink } from "../src/lib/drive-links.ts";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

// ============================================================
section("Nhận dạng MIME");
// ============================================================

check("image/jpeg là ảnh", isImageMime("image/jpeg"));
check("IMAGE/PNG (chữ hoa) vẫn nhận", isImageMime("IMAGE/PNG"));
check("video/mp4 là video", isVideoMime("video/mp4"));
check("image/jpeg không phải video", isVideoMime("image/jpeg") === false);
check("ảnh iPhone (image/heic) được nhận", isImageMime("image/heic"));
check("ảnh scan (image/tiff) được nhận", isImageMime("image/tiff"));
check("video AVI (video/x-msvideo) được nhận", isVideoMime("video/x-msvideo"));
check("loại media của video/quicktime = VIDEO", mediaKindFromMime("video/quicktime") === "VIDEO");
check("loại media của image/webp = IMAGE", mediaKindFromMime("image/webp") === "IMAGE");
check("application/pdf không dùng được", mediaKindFromMime("application/pdf") === null);
check("ảnh luôn dùng được dù tắt video", isSupportedMime("image/jpeg", false));
check("video bị loại khi tắt video", isSupportedMime("video/mp4", false) === false);
check("video nhận khi bật video", isSupportedMime("video/mp4", true));
check("file Google Docs bị nhận diện là native", isGoogleNative("application/vnd.google-apps.document"));
check("ảnh JPEG không phải file native", isGoogleNative("image/jpeg") === false);

// ============================================================
section("Đuôi file suy từ MIME");
// ============================================================

check("jpeg → .jpg", extensionForMime("image/jpeg") === ".jpg");
check("jpeg (biến thể image/jpg) → .jpg", extensionForMime("image/jpg") === ".jpg");
check("png → .png", extensionForMime("image/png") === ".png");
check("quicktime → .mov", extensionForMime("video/quicktime") === ".mov");
// Định dạng mở rộng sau sự cố "thư mục có ảnh mà không thấy ảnh nào"
check("heic (ảnh iPhone) → .heic", extensionForMime("image/heic") === ".heic");
check("avif → .avif", extensionForMime("image/avif") === ".avif");
check("bmp → .bmp", extensionForMime("image/bmp") === ".bmp");
check("tiff → .tiff", extensionForMime("image/tiff") === ".tiff");
check("x-msvideo → .avi", extensionForMime("video/x-msvideo") === ".avi");
check("matroska → .mkv", extensionForMime("video/x-matroska") === ".mkv");
check("MIME lạ hoàn toàn → mặc định .mp4", extensionForMime("video/ogg") === ".mp4");
check("danh sách ảnh không rỗng", IMAGE_MIMES.length >= 3);
check("danh sách video không rỗng", VIDEO_MIMES.length >= 2);

// ============================================================
section("Đọc metadata Drive trả về");
// ============================================================

const photo = mapDriveFile({
  id: "file-1",
  name: "Áo thun nam.jpg",
  mimeType: "image/jpeg",
  // Drive trả size dạng CHUỖI — phải ép Number
  size: "2451234",
  imageMediaMetadata: { width: 1600, height: 1200 },
  thumbnailLink: "https://lh3.googleusercontent.com/thumb",
  modifiedTime: "2026-09-19T04:00:00.000Z",
});

check("id đọc đúng", photo.id === "file-1");
check("size chuỗi được ép thành số", photo.size === 2451234);
check("width/height đọc đúng", photo.width === 1600 && photo.height === 1200);
check("ảnh không có duration", photo.duration === null);
check("thumbnailLink giữ nguyên", (photo.thumbnailLink ?? "").startsWith("https://"));

const clip = mapDriveFile({
  id: "file-2",
  name: "clip.mp4",
  mimeType: "video/mp4",
  size: "10485760",
  videoMediaMetadata: { durationMillis: 12500 },
});

check("durationMillis 12500 → 13 giây (làm tròn)", clip.duration === 13, String(clip.duration));

const missing = mapDriveFile({ id: "file-3" });
check("file thiếu name → nhãn mặc định", missing.name === "Không tên");
check("file thiếu size → null (không phải NaN)", missing.size === null);
check("file thiếu mimeType → chuỗi rỗng", missing.mimeType === "");
check("file thiếu mimeType không phải native", isGoogleNative(missing.mimeType) === false);

// ============================================================
section("Duyệt danh sách files[] của Drive");
// ============================================================

const page = mapDriveFiles(
  {
    nextPageToken: "token-trang-2",
    files: [
      { id: "a", name: "1.jpg", mimeType: "image/jpeg", size: "100" },
      { id: "b", name: "2.pdf", mimeType: "application/pdf" },
      { id: "c", name: "3.mp4", mimeType: "video/mp4" },
      { id: "d", name: "Tài liệu", mimeType: "application/vnd.google-apps.document" },
      { id: "", name: "không có id", mimeType: "image/png" },
      { id: "e", name: "4.png", mimeType: "image/png" },
    ],
  },
  true
);

check(
  "lọc bỏ PDF, file Google và phần tử thiếu id",
  JSON.stringify(page.files.map((f) => f.id)) === '["a","c","e"]',
  JSON.stringify(page.files.map((f) => f.id))
);
check("giữ nextPageToken", page.nextPageToken === "token-trang-2");

const noVideo = mapDriveFiles(
  { files: [{ id: "a", mimeType: "image/jpeg" }, { id: "c", mimeType: "video/mp4" }] },
  false
);
check("tắt video → chỉ còn ảnh", JSON.stringify(noVideo.files.map((f) => f.id)) === '["a"]');

check("files rỗng vẫn trả mảng rỗng", mapDriveFiles({}, true).files.length === 0);
check("dữ liệu rác không làm vỡ hàm", mapDriveFiles(null, true).files.length === 0);
check("nextPageToken thiếu → null", mapDriveFiles({ files: [] }, true).nextPageToken === null);

// ============================================================
section("Tên file an toàn khi gửi Facebook");
// ============================================================

check(
  "tên tiếng Việt có dấu được giữ, chỉ thay khoảng trắng",
  safeFileName("Áo thun nam.jpg", "image/jpeg") === "Áo-thun-nam.jpg",
  safeFileName("Áo thun nam.jpg", "image/jpeg")
);
check(
  "tên có đường dẫn bị làm phẳng",
  safeFileName("../../etc/passwd", "image/jpeg") === "etc-passwd.jpg",
  safeFileName("../../etc/passwd", "image/jpeg")
);
check(
  "ký tự lạ bị thay bằng gạch ngang",
  safeFileName('a"b\\c:d*e.jpg', "image/jpeg") === "a-b-c-d-e.jpg",
  safeFileName('a"b\\c:d*e.jpg', "image/jpeg")
);
check("video mp4 được thêm đuôi", safeFileName("clip", "video/mp4") === "clip.mp4");
check(
  "không thêm đuôi trùng",
  safeFileName("clip.mp4", "video/mp4") === "clip.mp4",
  safeFileName("clip.mp4", "video/mp4")
);
check(
  "tên rỗng → tên mặc định",
  safeFileName("", "image/jpeg") === "drive-file.jpg",
  safeFileName("", "image/jpeg")
);
check(
  "tên quá dài bị cắt",
  safeFileName("x".repeat(300) + ".jpg", "image/jpeg").length <= 85,
  String(safeFileName("x".repeat(300) + ".jpg", "image/jpeg").length)
);
check(
  "tên toàn ký tự lạ vẫn ra tên dùng được",
  safeFileName("///", "image/png") === "drive-file.png",
  safeFileName("///", "image/png")
);

// ============================================================
section("Đọc link thư mục Drive (khi Picker không chạy được)");
// ============================================================

const FOLDER_ID = "1AbC_dEf-GhI2jKlMnOpQrStUvWxYz012";
const FOLDER_ID_2 = "0BxxYYzz-shared-drive-id-99";

check(
  "link /drive/folders/<ID>",
  parseDriveFolderLink(`https://drive.google.com/drive/folders/${FOLDER_ID}`).folderId === FOLDER_ID
);
check(
  "link có /u/0/ (nhiều tài khoản Google)",
  parseDriveFolderLink(`https://drive.google.com/drive/u/0/folders/${FOLDER_ID}`).folderId === FOLDER_ID
);
check(
  "link /drive/mobile/folders/<ID> (copy từ điện thoại)",
  parseDriveFolderLink(`https://drive.google.com/drive/mobile/folders/${FOLDER_ID}`).folderId ===
    FOLDER_ID
);
check(
  "link /open?id=<ID>",
  parseDriveFolderLink(`https://drive.google.com/open?id=${FOLDER_ID}&usp=drive_fs`).folderId ===
    FOLDER_ID
);
check(
  "link có tham số ?usp=sharing phía sau",
  parseDriveFolderLink(`https://drive.google.com/drive/folders/${FOLDER_ID}?usp=sharing`).folderId ===
    FOLDER_ID
);
check(
  "dán thẳng ID (không phải URL)",
  parseDriveFolderLink(FOLDER_ID).folderId === FOLDER_ID
);
check(
  "link shared drive /drive/u/1/folders/<ID>",
  parseDriveFolderLink(`https://drive.google.com/drive/u/1/folders/${FOLDER_ID_2}`).folderId ===
    FOLDER_ID_2
);

// --- Các trường hợp phải BÁO LỖI rõ ràng ---
const fileLink = parseDriveFolderLink(`https://drive.google.com/file/d/${FOLDER_ID}/view`);
check("link của TỆP → báo lỗi, không nhận nhầm", fileLink.ok === false && /TỆP/.test(fileLink.error), fileLink.error ?? "");

const emptyLink = parseDriveFolderLink("   ");
check("chuỗi rỗng → báo lỗi", emptyLink.ok === false);

const notDrive = parseDriveFolderLink("https://example.com/folders/abc123456789");
check("link không phải Drive → báo lỗi", notDrive.ok === false && /Google Drive/.test(notDrive.error), notDrive.error ?? "");

const randomShort = parseDriveFolderLink("hello world khong phai id");
check("chuỗi lạ → báo lỗi, không tạo ID rác", randomShort.ok === false);

// ============================================================
section("Đọc link TỆP Drive (ảnh lẻ)");
// ============================================================

check(
  "link /file/d/<ID>/view",
  parseDriveFileLink(`https://drive.google.com/file/d/${FOLDER_ID}/view?usp=drive_link`).driveFileId ===
    FOLDER_ID
);
check(
  "dán thẳng ID tệp",
  parseDriveFileLink(FOLDER_ID).driveFileId === FOLDER_ID
);
const folderAsFile = parseDriveFileLink(`https://drive.google.com/drive/folders/${FOLDER_ID}`);
check(
  "link THƯ MỤC dán vào ô tệp → báo lỗi hướng dẫn đúng",
  folderAsFile.ok === false && /THƯ MỤC/.test(folderAsFile.error),
  folderAsFile.error ?? ""
);
check("link tệp rỗng → báo lỗi", parseDriveFileLink("").ok === false);

// ============================================================
console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
