// Mock OpenAI-compatible provider — dùng để smoke test chức năng tải model.
// Chạy: node scripts/mock-ai-server.mjs  (mặc định cổng 4010)
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4010);
const VALID_KEY = "test-key-abc123";

const MODELS = [
  { id: "mock-gpt-4o" },
  { id: "mock-gpt-4o-mini" },
  { id: "mock-deepseek-chat" },
  { id: "mock-claude-sonnet" },
];

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Nhật ký prompt gần đây (chỉ dùng cho test kiểm chứng nội dung gửi AI). */
const promptLog = [];

createServer((req, res) => {
  const auth = req.headers.authorization ?? "";
  const url = new URL(req.url, `http://localhost:${PORT}`);
  console.log(`${req.method} ${url.pathname} auth=${auth ? "có" : "không"}`);

  // Endpoint chỉ dành cho test — đặt TRƯỚC lớp auth để test không cần API key
  if (url.pathname === "/__prompts") {
    if (req.method === "DELETE") {
      promptLog.length = 0;
      return json(res, 200, { ok: true });
    }
    return json(res, 200, { prompts: promptLog });
  }

  if (!auth.startsWith("Bearer ")) {
    return json(res, 401, {
      error: { message: "Missing Authorization header", type: "invalid_request_error" },
    });
  }
  if (auth.slice(7) !== VALID_KEY) {
    return json(res, 401, {
      error: { message: "Incorrect API key provided", type: "invalid_request_error" },
    });
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return json(res, 200, { object: "list", data: MODELS });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (!body.model) {
        return json(res, 400, { error: { message: "model is required" } });
      }
      if (!MODELS.some((m) => m.id === body.model)) {
        return json(res, 404, {
          error: { message: `The model '${body.model}' does not exist` },
        });
      }

      const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
      const user = body.messages?.find((m) => m.role === "user")?.content ?? "";

      // Lưu lại để test kiểm tra prompt có kèm hồ sơ thương hiệu không
      promptLog.push({ at: new Date().toISOString(), system, user });
      if (promptLog.length > 50) promptLog.shift();

      const reply = (id, content, usage) =>
        json(res, 200, {
          id,
          model: body.model,
          choices: [
            { message: { role: "assistant", content }, finish_reason: "stop" },
          ],
          usage,
        });

      // ---- 1. Gợi ý từ khóa tìm ảnh (prompt nói về Pexels + từ khóa) ----
      if (/từ khóa/i.test(system) && /Pexels/i.test(system)) {
        return reply(
          "chatcmpl-mock-kw",
          JSON.stringify({
            keywords: [
              { label: "Quán cà phê", query: "coffee shop" },
              { label: "Ly cà phê", query: "coffee cup" },
              { label: "Nhân viên pha chế", query: "barista" },
            ],
          }),
          { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 }
        );
      }

      // ---- 2. Sinh nội dung bài đăng (prompt có "Chủ đề bài đăng") ----
      if (/Chủ đề bài đăng/.test(user)) {
        const topic = user.match(/Chủ đề bài đăng:\s*(.+)/)?.[1]?.trim() ?? "chủ đề";
        const count = Number(user.match(/Hãy viết (\d+) phương án/)?.[1] ?? 3);
        const kw = user.match(/Từ khóa cần có trong bài:\s*(.+)/)?.[1]?.trim() ?? "";

        const variants = Array.from({ length: count }, (_, i) => ({
          angle: ["Kể chuyện", "Liệt kê lợi ích", "Câu hỏi gây tò mò"][i] ?? `Góc ${i + 1}`,
          content:
            `[MOCK-AI phương án ${i + 1}] ${topic}\n\n` +
            `Đây là nội dung do mock provider sinh ra để test luồng Tuần 3. ` +
            `Phương án này dùng góc tiếp cận số ${i + 1}.` +
            (kw ? `\n\nTừ khóa: ${kw}` : "") +
            `\n\n👉 Bấm "Dùng phương án này" để đưa vào trình soạn thảo.`,
          hashtags: `#mock #phuongan${i + 1} #tuan3`,
        }));

        return reply(
          "chatcmpl-mock-gen",
          JSON.stringify({ variants }),
          { prompt_tokens: 320, completion_tokens: 480, total_tokens: 800 }
        );
      }

      // ---- 3. Còn lại: kiểm tra kết nối (ping ngắn) ----
      return reply("chatcmpl-mock", "OK", {
        prompt_tokens: 8,
        completion_tokens: 2,
        total_tokens: 10,
      });
    });
    return;
  }

  json(res, 404, { error: { message: `Unknown endpoint ${url.pathname}` } });
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `✗ Cổng ${PORT} đang bị chiếm — có thể một mock server cũ vẫn đang chạy.\n` +
        "  Hãy tắt tiến trình cũ, hoặc chạy lại với cổng khác: PORT=<cổng-mới> node <script>"
    );
    process.exit(1);
  }
  throw err;
}).listen(PORT, () => console.log(`Mock AI provider: http://127.0.0.1:${PORT}/v1`));
