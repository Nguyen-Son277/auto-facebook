import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/dal";
import { deleteUpload, resolveUploadPath } from "@/lib/uploads";

// ============================================================
// GET    /api/uploads/[key] — phát lại file upload (xem trước video).
// DELETE /api/uploads/[key] — xóa file khi người dùng bỏ khỏi khay.
//
// key chỉ được là tên file do app sinh ra; file luôn nằm trong thư mục
// của user đang đăng nhập (xem lib/uploads.ts).
// ============================================================

type Ctx = { params: Promise<{ key: string }> };

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
};

function mimeOf(key: string) {
  const ext = key.slice(key.lastIndexOf("."));
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export async function GET(request: Request, { params }: Ctx) {
  const user = await requireCurrentUser();
  const { key } = await params;

  let filePath: string;
  try {
    filePath = resolveUploadPath(user.id, key);
  } catch {
    return NextResponse.json({ error: "Tên file không hợp lệ." }, { status: 400 });
  }

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "Không tìm thấy file." }, { status: 404 });
  }

  const mime = mimeOf(key);
  const range = request.headers.get("range");

  // Hỗ trợ Range để trình duyệt tua được video
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : size - 1;
      if (Number.isNaN(start) || start >= size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      const safeEnd = Math.min(end, size - 1);
      const stream = Readable.toWeb(
        createReadStream(filePath, { start, end: safeEnd })
      ) as ReadableStream;

      return new NextResponse(stream, {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Length": String(safeEnd - start + 1),
          "Content-Range": `bytes ${start}-${safeEnd}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await requireCurrentUser();
  const { key } = await params;
  await deleteUpload(user.id, key);
  return NextResponse.json({ ok: true });
}
