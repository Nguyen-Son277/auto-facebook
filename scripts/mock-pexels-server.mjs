// Mock Pexels API — dùng cho test E2E luồng tìm ảnh/video.
// Chạy: node scripts/mock-pexels-server.mjs   (mặc định cổng 4030)
// Trỏ app về đây bằng biến môi trường: PEXELS_BASE_URL=http://127.0.0.1:4030
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4030);
const VALID_KEY = "pexels-test-key";

/** Băm chuỗi đơn giản → mỗi từ khóa cho dải ID riêng, giống Pexels thật. */
function hashOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
  return h;
}

const photo = (n, label) => ({
  id: 900000 + hashOf(label) * 100 + n,
  width: 1920,
  height: 1280,
  url: `https://www.pexels.com/photo/mock-${n}/`,
  photographer: `Tác giả ${label}`,
  photographer_url: `https://www.pexels.com/@tac-gia-${n}/`,
  avg_color: "#a3b18a",
  alt: `Ảnh mock ${label} số ${n}`,
  src: {
    original: `http://127.0.0.1:${PORT}/files/photo-${n}-original.jpg`,
    large2x: `http://127.0.0.1:${PORT}/files/photo-${n}-large2x.jpg`,
    large: `http://127.0.0.1:${PORT}/files/photo-${n}-large.jpg`,
    medium: `http://127.0.0.1:${PORT}/files/photo-${n}-medium.jpg`,
    small: `http://127.0.0.1:${PORT}/files/photo-${n}-small.jpg`,
    tiny: `http://127.0.0.1:${PORT}/files/photo-${n}-tiny.jpg`,
  },
});

const video = (n, label) => ({
  id: 800000 + hashOf(label) * 100 + n,
  width: 1920,
  height: 1080,
  url: `https://www.pexels.com/video/mock-${n}/`,
  image: `http://127.0.0.1:${PORT}/files/video-${n}-thumb.jpg`,
  duration: 12 + n,
  user: { name: `Tác giả video ${label}`, url: `https://www.pexels.com/@video-${n}/` },
  video_files: [
    // Bản 4K nặng — không nên được chọn
    {
      id: 1,
      quality: "uhd",
      file_type: "video/mp4",
      width: 3840,
      height: 2160,
      link: `http://127.0.0.1:${PORT}/files/video-${n}-4k.mp4`,
    },
    // Bản HD — nên được chọn
    {
      id: 2,
      quality: "hd",
      file_type: "video/mp4",
      width: 1920,
      height: 1080,
      link: `http://127.0.0.1:${PORT}/files/video-${n}-hd.mp4`,
    },
  ],
});

// ---- Sổ theo dõi để test kiểm chứng ngân sách request ----
const callLog = [];
/** Số request còn lại; test có thể ép về 0 để giả lập hết hạn mức. */
let remaining = 200;
const LIMIT = 200;
/** Khi bật, mọi request tìm kiếm trả 429. */
let force429 = false;

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    // Header hạn mức — client thật đọc những header này
    "x-ratelimit-limit": String(LIMIT),
    "x-ratelimit-remaining": String(Math.max(remaining, 0)),
    "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

/** Ảnh JPEG 1x1 để trình duyệt render được preview trong test. */
const PIXEL = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const auth = req.headers.authorization;

  // Phục vụ file ảnh để preview hiển thị được
  if (url.pathname.startsWith("/files/")) {
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=60" });
    return res.end(PIXEL);
  }

  // ---- Endpoint phục vụ test (không cần key, không tính vào hạn mức) ----
  if (url.pathname === "/__calls") {
    if (req.method === "DELETE") {
      callLog.length = 0;
      remaining = 200;
      force429 = false;
      return json(res, 200, { ok: true });
    }
    return json(res, 200, { count: callLog.length, calls: callLog, remaining });
  }

  if (url.pathname === "/__force429") {
    force429 = url.searchParams.get("off") !== "1";
    return json(res, 200, { ok: true, force429 });
  }

  if (url.pathname !== "/v1/search" && url.pathname !== "/v1/curated" &&
      url.pathname !== "/videos/search" && url.pathname !== "/videos/popular") {
    return json(res, 404, { error: `Unknown endpoint ${url.pathname}` });
  }

  if (!auth) {
    console.log(`   ↳ 401 THIẾU Authorization header`);
    return json(res, 401, { error: "Authorization header required" });
  }
  if (auth !== VALID_KEY) {
    console.log(`   ↳ 401 SAI KEY`);
    return json(res, 401, { error: "Invalid API key" });
  }

  const query = url.searchParams.get("query") ?? "";
  const page = Number(url.searchParams.get("page") ?? 1);
  const perPage = Number(url.searchParams.get("per_page") ?? 12);

  callLog.push({ path: url.pathname, query, page, perPage, at: Date.now() });
  remaining = Math.max(remaining - 1, 0);
  console.log(`${url.pathname} query="${query}" page=${page} (còn ${remaining})`);

  // Giả lập vượt hạn mức
  if (force429 || remaining <= 0) {
    console.log(`   ↳ 429 VƯỢT HẠN MỨC`);
    return json(res, 429, { error: "Rate limit exceeded" });
  }

  // Từ khóa đặc biệt để test trường hợp không có kết quả
  if (query.toLowerCase() === "khong-co-ket-qua") {
    return json(res, 200, { page, per_page: perPage, total_results: 0, photos: [], videos: [] });
  }

  if (url.pathname === "/v1/search" || url.pathname === "/v1/curated") {
    const label = query || "phổ biến";
    return json(res, 200, {
      page,
      per_page: perPage,
      total_results: 42,
      next_page: `http://127.0.0.1:${PORT}${url.pathname}?page=${page + 1}`,
      photos: Array.from({ length: perPage }, (_, i) => photo(i + 1 + (page - 1) * perPage, label)),
    });
  }

  const label = query || "phổ biến";
  return json(res, 200, {
    page,
    per_page: perPage,
    total_results: 18,
    next_page: page < 2 ? `http://127.0.0.1:${PORT}${url.pathname}?page=${page + 1}` : undefined,
    videos: Array.from({ length: perPage }, (_, i) => video(i + 1 + (page - 1) * perPage, label)),
  });
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `✗ Cổng ${PORT} đang bị chiếm — có thể một mock server cũ vẫn đang chạy.\n` +
        "  Hãy tắt tiến trình cũ, hoặc chạy lại với cổng khác: PORT=<cổng-mới> node <script>"
    );
    process.exit(1);
  }
  throw err;
}).listen(PORT, () =>
  console.log(`Mock Pexels: http://127.0.0.1:${PORT} (key: ${VALID_KEY}, dùng PEXELS_BASE_URL)`)
);
