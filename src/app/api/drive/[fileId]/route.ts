import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { DriveError, downloadFile, driveErrorMessage, getFile, listFolderMedia } from "@/lib/drive";

// ============================================================
// GET /api/drive/[fileId] — xem trước ảnh/video trên Google Drive.
//
// ĐÂY KHÔNG PHẢI đường đăng bài lên Facebook. Facebook không đọc được link
// Drive riêng tư, nên khi đăng bài app tải binary rồi upload multipart
// (xem lib/deliver.ts). Route này chỉ để giao diện hiển thị ảnh.
//
// GIỚI HẠN: Vercel Function giới hạn response 4.5MB. Ảnh/video lớn hơn sẽ
// hỏng khung xem trước — đó là lý do UI nên ưu tiên thumbnail của Drive.
//
// KIỂM QUYỀN: fileId đến từ client nên không được tin. Chỉ phục vụ khi tệp
// thực sự thuộc người dùng này:
//   1. có bản ghi Media (source = DRIVE) của họ trỏ tới fileId, HOẶC
//   2. tệp nằm trong thư mục Drive đã gắn cho một thương hiệu của họ.
// Ngoài ra Drive API cũng chặn ở phía Google (scope drive.file).
// ============================================================

type Ctx = { params: Promise<{ fileId: string }> };

/** fileId của Drive là chuỗi chữ/số/gạch/dấu gạch dưới — chặn input lạ. */
const FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{5,200}$/;

export async function GET(_request: Request, { params }: Ctx) {
  const user = await requireCurrentUser();
  const { fileId } = await params;

  if (!FILE_ID_PATTERN.test(fileId)) {
    return NextResponse.json({ error: "Mã tệp không hợp lệ." }, { status: 400 });
  }

  const conn = await prisma.driveConnection.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!conn || conn.status === "DISABLED") {
    return NextResponse.json(
      { error: "Chưa kết nối Google Drive." },
      { status: 401 }
    );
  }

  const allowed = await canServe(user.id, conn.id, fileId);
  if (!allowed) {
    // Không phân biệt "không tồn tại" và "không có quyền" để không lộ thông tin.
    return NextResponse.json({ error: "Không tìm thấy tệp." }, { status: 404 });
  }

  try {
    // Lấy metadata trước để có MIME + kích thước chuẩn (và để đồng bộ trạng thái
    // connection nếu token đã bị thu hồi).
    const meta = await getFile(conn.id, fileId);
    const upstream = await downloadFile(conn.id, fileId);

    const headers = new Headers({
      "Content-Type": meta.mimeType || "application/octet-stream",
      // signedUrl-like: private, và đừng để CDN giữ lâu hơn nguồn
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    });

    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    const message = driveErrorMessage(err);
    const code = err instanceof DriveError ? err.code : "HTTP";

    if (code === "NOT_FOUND") {
      return NextResponse.json({ error: "Không tìm thấy tệp." }, { status: 404 });
    }
    if (code === "QUOTA" || code === "RATE_LIMIT") {
      return NextResponse.json({ error: message }, { status: 429 });
    }
    if (code === "NETWORK") {
      return NextResponse.json({ error: message }, { status: 504 });
    }

    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * Tệp này có thuộc quyền người dùng không?
 *
 * Kiểm tra rẻ nhất trước: bản ghi Media đã có (thư viện hoặc bài đã lưu), rồi
 * tới thư mục Drive đã gắn cho thương hiệu.
 */
async function canServe(userId: string, connectionId: string, fileId: string): Promise<boolean> {
  const inLibrary = await prisma.media.findFirst({
    where: { userId, source: "DRIVE", providerId: fileId },
    select: { id: true },
  });
  if (inLibrary) return true;

  const folders = await prisma.brandDriveFolder.findMany({
    where: { connectionId },
    select: { folderId: true },
  });
  if (folders.length === 0) return false;

  // Tệp nằm trực tiếp trong thư mục đã gắn? (một lượt gọi Drive, có cache)
  for (const folder of folders) {
    if (await folderContains(connectionId, folder.folderId, fileId)) return true;
  }
  return false;
}

/** Cache kết quả "thư mục có chứa file này" 5 phút — UI hay hỏi lại cùng tệp. */
const folderCache = new Map<string, { at: number; files: Set<string> }>();
const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;

async function folderContains(
  connectionId: string,
  folderId: string,
  fileId: string
): Promise<boolean> {
  const key = `${connectionId}|${folderId}`;
  const hit = folderCache.get(key);
  if (hit && Date.now() - hit.at < FOLDER_CACHE_TTL_MS) return hit.files.has(fileId);

  try {
    const page = await listFolderMedia(connectionId, folderId, { pageSize: 200 });
    const files = new Set(page.files.map((f) => f.id));
    folderCache.set(key, { at: Date.now(), files });
    return files.has(fileId);
  } catch {
    // Drive lỗi tạm thời → không kết luận là "có quyền"; UI sẽ hiện lại sau.
    return false;
  }
}
