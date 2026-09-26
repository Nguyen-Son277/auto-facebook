// Mock Facebook Graph API — dùng cho test E2E luồng đăng bài.
// Chạy: node scripts/mock-fb-server.mjs   (mặc định cổng 4020)
// Trỏ app về đây bằng biến môi trường: FB_GRAPH_BASE_URL=http://127.0.0.1:4020
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4020);
let counter = 0;

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Tách các phần của body multipart/form-data.
 * Trả về { fields, files } — files giữ tên trường + tên file + số byte thật,
 * để test kiểm chứng được rằng app gửi kèm FILE chứ không phải chỉ tên file.
 */
function parseMultipart(buffer, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};

  let pos = buffer.indexOf(delim);
  if (pos === -1) return { fields, files };

  while (pos !== -1) {
    const start = pos + delim.length;
    // "--" ngay sau delimiter = phần kết thúc
    if (buffer.slice(start, start + 2).toString() === "--") break;

    const headerEnd = buffer.indexOf("\r\n\r\n", start);
    if (headerEnd === -1) break;

    const headerText = buffer.slice(start, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;

    const next = buffer.indexOf(delim, bodyStart);
    if (next === -1) break;
    // Bỏ \r\n ngay trước delimiter
    const bodyEnd = next - 2;
    const content = buffer.slice(bodyStart, bodyEnd);

    const nameMatch = /name="([^"]*)"/.exec(headerText);
    const fileMatch = /filename="([^"]*)"/.exec(headerText);
    const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);

    if (nameMatch) {
      if (fileMatch) {
        files[nameMatch[1]] = {
          filename: fileMatch[1],
          contentType: typeMatch ? typeMatch[1].trim() : "application/octet-stream",
          bytes: content.length,
        };
      } else {
        fields[nameMatch[1]] = content.toString("utf8");
      }
    }

    pos = buffer.indexOf(delim, next);
  }

  return { fields, files };
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] ?? "";

      // Upload video: Graph API nhận multipart/form-data với trường `source`
      if (contentType.startsWith("multipart/form-data")) {
        const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
        const b = boundary?.[1] ?? boundary?.[2];
        if (!b) return resolve({ params: {}, files: {}, multipart: true });
        const { fields, files } = parseMultipart(raw, b.trim());
        return resolve({ params: fields, files, multipart: true });
      }

      // Graph API nhận tham số qua query (GET) hoặc body form-urlencoded (POST)
      const params = new URLSearchParams(raw.toString("utf8"));
      resolve({ params: Object.fromEntries(params.entries()), files: {}, multipart: false });
    });
  });
}

/** Sổ ghi các bài đã nhận (chỉ dùng cho test kiểm chứng). */
const receivedPosts = [];

/**
 * Sổ ghi các lệnh gọi insights (chỉ dùng cho test kiểm chứng hạn mức).
 *
 * Vì sao cần: tính năng đọc số liệu chạy nền định kỳ cho mọi Page, nên số lệnh
 * gọi Graph API là thứ phải kiểm soát được. Test dùng sổ này để khẳng định
 * code không gọi dồn dập khi Facebook từ chối metric.
 */
const insightCalls = [];

/**
 * Số liệu giả lập của một bài, suy từ ID bài để mỗi bài có kết quả khác nhau.
 *
 * Cố ý tạo tương quan có kiểm soát: bài có số cuối ID chẵn thì hiệu quả cao,
 * lẻ thì thấp. Nhờ vậy test kiểm chứng được phần XẾP HẠNG (bài tốt phải được
 * nhận ra là tốt) chứ không chỉ kiểm tra "có chạy hay không".
 */
function insightPayloadFor(objectId, metricNames) {
  const digits = String(objectId).replace(/\D/g, "");
  const seed = Number(digits.slice(-2) || "0");
  const strong = seed % 2 === 0;
  const base = strong ? 4000 : 800;

  const values = {
    post_media_view: base,
    post_total_media_view_unique: Math.round(base * 0.6),
    post_impressions: Math.round(base * 1.2),
    post_video_views: Math.round(base * 0.3),
    post_video_avg_time_watched: strong ? 4200 : 1500,
    post_clicks: strong ? 120 : 30,
    post_reactions_by_type_total: strong
      ? { like: 180, love: 40, wow: 10, haha: 5, sorry: 0, anger: 0 }
      : { like: 20, love: 3, wow: 0, haha: 0, sorry: 0, anger: 0 },
    page_impressions: 24000,
    page_media_view: 12000,
    page_total_media_view_unique: 7000,
    page_post_engagements: 900,
    page_views_total: 1500,
    page_fans: 3400,
    page_follows: 3500,
    page_fans_city: { "Hồ Chí Minh": 1200, "Bình Dương": 800, "Hà Nội": 300 },
  };

  const data = metricNames
    .filter((m) => values[m] !== undefined)
    .map((m) => ({
      name: m,
      period: "lifetime",
      values: [{ value: values[m] }],
    }));

  return { data };
}

/** Danh sách bài giả lập của một Page, dùng cho `GET /{page-id}/posts`. */
function postsPayloadFor(pageId) {
  const now = Date.now();
  return {
    data: Array.from({ length: 6 }, (_, i) => {
      // ID có số cuối chẵn/lẻ xen kẽ để tạo cả bài hiệu quả cao lẫn thấp
      const id = `${pageId}_${100000 + i}`;
      const strong = i % 2 === 0;
      return {
        id,
        created_time: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
        reactions: { summary: { total_count: strong ? 200 : 18 } },
        comments: { summary: { total_count: strong ? 25 : 2 } },
        shares: { count: strong ? 12 : 0 },
      };
    }),
  };
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Endpoint dành riêng cho test — đặt trước mọi lớp kiểm tra token
  if (url.pathname === "/__posts") {
    if (req.method === "DELETE") {
      receivedPosts.length = 0;
      return json(res, 200, { ok: true });
    }
    return json(res, 200, { posts: receivedPosts });
  }

  // Sổ lệnh gọi insights + công tắc giả lập lỗi (dùng cho test nhánh lùi)
  if (url.pathname === "/__insights") {
    if (req.method === "DELETE") {
      insightCalls.length = 0;
      return json(res, 200, { ok: true });
    }
    return json(res, 200, { calls: insightCalls });
  }

  const { params: body, files, multipart } = await readBody(req);
  const query = Object.fromEntries(url.searchParams.entries());
  const token = query.access_token ?? body.access_token;

  console.log(
    `${req.method} ${url.pathname} token=${token ? token.slice(0, 12) + "…" : "KHÔNG CÓ"}` +
      (req.method === "POST"
        ? ` fields=[${Object.keys(body).join(",")}]` +
          (multipart
            ? ` files=[${Object.entries(files)
                .map(([k, f]) => `${k}:${f.filename}:${f.bytes}B`)
                .join(",")}]`
            : "")
        : "")
  );

  if (!token) {
    return json(res, 400, {
      error: { message: "An access token is required to request this resource.", code: 104 },
    });
  }

  // /{version}/{pageId}/feed|photos|videos → giả lập đăng bài thành công.
  // GET vào các endpoint này bị từ chối đúng như Graph API thật — nhờ vậy test
  // sẽ phát hiện nếu code lỡ gọi GET để đăng bài (Graph API yêu cầu POST).
  const publishMatch = url.pathname.match(/^\/v[\d.]+\/([^/]+)\/(feed|photos|videos)$/);
  if (publishMatch) {
    const pageId = publishMatch[1];
    if (req.method !== "POST") {
      console.log(`   ↳ TỪ CHỐI ${req.method} — đăng bài phải dùng POST`);
      return json(res, 405, {
        error: {
          message: `Unsupported get request. Object with ID '${pageId}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`,
          code: 100,
        },
      });
    }
    // /feed bắt buộc có message; /photos bắt buộc có url; /videos bắt buộc có file_url
    const kind = publishMatch[2];
    if (kind === "feed" && !body.message) {
      return json(res, 400, {
        error: { message: "Nội dung bài đăng không được để trống.", code: 100 },
      });
    }
    if (kind === "photos" && !body.url) {
      return json(res, 400, {
        error: { message: "Cần tham số url của ảnh.", code: 100 },
      });
    }
    if (kind === "videos") {
      const source = files.source;
      if (!body.file_url && !source) {
        return json(res, 400, {
          error: {
            message: "Cần tham số file_url hoặc file source của video.",
            code: 100,
          },
        });
      }
      if (source) {
        // Kiểm tra file thật sự có nội dung (không phải file rỗng)
        if (source.bytes <= 0) {
          return json(res, 400, {
            error: { message: "File video rỗng.", code: 100 },
          });
        }
        console.log(
          `   ↳ upload video: ${source.filename} (${source.contentType}, ${source.bytes} byte)`
        );
      }
    }
    counter += 1;
    const id = `${pageId}_${100000 + counter}`;
    receivedPosts.push({
      id,
      pageId,
      kind,
      message: body.message ?? body.caption ?? "",
      url: body.url ?? body.file_url ?? null,
      at: new Date().toISOString(),
    });
    if (receivedPosts.length > 100) receivedPosts.shift();
    console.log(`   ↳ OK ${kind} → ${id}`);
    return json(res, 200, { id });
  }

  // GET /{version}/me/accounts → danh sách Page
  if (req.method === "GET" && /^\/v[\d.]+\/me\/accounts$/.test(url.pathname)) {
    return json(res, 200, {
      data: [
        {
          id: "111222333444555",
          name: "Mock Page Kinh Doanh",
          access_token: "mock-page-token-abc",
          category: "Business",
        },
      ],
    });
  }

  // GET /{version}/oauth/access_token → đổi token (dùng khi test đồng bộ Pages)
  if (/^\/v[\d.]+\/oauth\/access_token$/.test(url.pathname)) {
    return json(res, 200, {
      access_token: "mock-long-lived-user-token",
      token_type: "Bearer",
      expires_in: 5184000,
    });
  }

  // GET /{version}/{page-id}/posts → danh sách bài kèm summary tương tác.
  // Đây là nhóm số liệu KHÔNG cần quyền read_insights nên phải luôn chạy được.
  const postsMatch = url.pathname.match(/^\/v[\d.]+\/([^/]+)\/posts$/);
  if (postsMatch && req.method === "GET") {
    const pageId = postsMatch[1];
    insightCalls.push({ at: new Date().toISOString(), kind: "posts", pageId });
    if (insightCalls.length > 200) insightCalls.shift();

    // Chế độ giả lập lỗi để test nhánh lùi
    const mode = query.__mode ?? body.__mode;
    if (mode === "token_invalid") {
      return json(res, 400, {
        error: { message: "Invalid OAuth access token.", code: 190 },
      });
    }
    if (mode === "low_fans") {
      return json(res, 400, {
        error: {
          message: "Page Insights data is only available on Pages with 100 or more likes.",
          code: 100,
        },
      });
    }

    return json(res, 200, postsPayloadFor(pageId));
  }

  // GET /{version}/{object-id}/insights?metric=a,b,c
  const insightsMatch = url.pathname.match(/^\/v[\d.]+\/([^/]+)\/insights$/);
  if (insightsMatch && req.method === "GET") {
    const objectId = insightsMatch[1];
    const metricParam = query.metric ?? body.metric ?? "";
    const metricNames = metricParam.split(",").map((m) => m.trim()).filter(Boolean);
    const mode = query.__mode ?? body.__mode;

    insightCalls.push({
      at: new Date().toISOString(),
      kind: "insights",
      objectId,
      metrics: metricNames,
    });
    if (insightCalls.length > 200) insightCalls.shift();

    if (metricNames.length === 0) {
      // Đúng hành vi thật của Graph API khi thiếu tham số metric
      return json(res, 400, {
        error: {
          message:
            "No metric was specified to be fetched. Please specify one or more metrics to be fetched and try again.",
          code: 3001,
          error_subcode: 1504028,
        },
      });
    }

    // Giả lập metric đã bị Meta ngừng hỗ trợ: TOÀN BỘ lệnh gọi hỏng nếu danh
    // sách chứa metric bị bỏ — đúng hành vi thật, và đây là lý do code phải
    // biết lùi về nhóm metric nhỏ hơn.
    if (mode === "invalid_metric" || metricNames.includes("post_impressions_unique")) {
      return json(res, 400, {
        error: {
          message: `(#3001) Invalid metric: ${metricNames.join(", ")}`,
          code: 3001,
          error_subcode: 1504028,
        },
      });
    }

    if (mode === "no_permission") {
      return json(res, 400, {
        error: {
          message:
            "Permissions error: read_insights permission is required to access insights.",
          code: 200,
        },
      });
    }

    if (mode === "not_found") {
      return json(res, 400, {
        error: {
          message: "Unsupported get request. Object does not exist or cannot be loaded.",
          code: 100,
        },
      });
    }

    return json(res, 200, insightPayloadFor(objectId, metricNames));
  }

  json(res, 404, {
    error: { message: `Unknown endpoint ${url.pathname}`, code: 803 },
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
  console.log(`Mock Facebook Graph API: http://127.0.0.1:${PORT} (dùng FB_GRAPH_BASE_URL)`)
);
