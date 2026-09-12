// ============================================================
// Seed docs hướng dẫn mặc định + câu hỏi mẫu (idempotent).
//
// Chạy: npm run db:seed-docs
// - Upsert theo slug: có thì cập nhật nội dung, chưa có thì tạo.
// - Mọi doc đều published để user đọc được ngay tại /docs.
// - Cần DB đã có ít nhất 1 user ADMIN (làm authorId).
// ============================================================

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", process.env.PROD_DB ?? "dev.db");

const db = new Database(DB_PATH);
db.pragma("wal_checkpoint(TRUNCATE)");

const author = db
  .prepare("SELECT id, email FROM User WHERE role = 'ADMIN' ORDER BY createdAt ASC LIMIT 1")
  .get();

if (!author) {
  console.error("✗ Chưa có user ADMIN nào — chạy `npm run db:seed-admin` trước.");
  process.exit(1);
}

const slugify = (t) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "doc";

const docs = [
  {
    title: "Bắt đầu trong 5 phút",
    notifyOnPublish: false,
    body: `# Bắt đầu trong 5 phút

Chào mừng bạn đến với **FB Marketing Auto** — hệ thống tự động hóa đăng bài Facebook: AI viết nội dung, tự tìm ảnh/video từ Pexels, đăng ngay hoặc hẹn giờ.

## Luồng tổng thể

1. **Thêm Facebook App** — vào trang [Facebook Apps](/facebook-apps), tạo App với App ID + App Secret của bạn.
2. **Đồng bộ Pages** — dán User Access Token của App đó, bấm **Đồng bộ Pages** để nhập các trang bạn quản lý.
3. **Cấu hình AI & Pexels** — vào [Cài đặt](/settings), nhập Base URL + API Key của nhà cung cấp AI và API Key Pexels.
4. **Soạn bài đầu tiên** — vào [Soạn bài](/composer), chọn thương hiệu + chủ đề, bấm ✨ **Sinh nội dung** để AI viết 2–3 phương án.
5. **Hẹn giờ hoặc đăng ngay** — chọn thời điểm đăng hoặc bấm Đăng ngay. Bài hẹn giờ sẽ tự động đăng đúng giờ, không cần mở trình duyệt.

## Mẹo quan trọng

- Tạo **hồ sơ thương hiệu** ở trang [Thương hiệu](/brand) càng chi tiết, AI viết càng đúng chất thương hiệu của bạn.
- Bật **AutoPilot** ở trang [Tự động đăng](/autopilot) khi muốn hệ thống tự lập kế hoạch và tạo bài hằng ngày.
- Mọi hoạt động đều được ghi ở [Lịch sử đăng](/history) và hiển thị trên [Lịch đăng](/calendar).

## Bạn cần trợ giúp?

Đọc các bài hướng dẫn chi tiết ngay trang này, hoặc trả lời các câu hỏi ở mục **"Câu hỏi từ đội ngũ phát triển"** — góp ý của bạn sẽ được dùng để cải thiện hệ thống.`,
  },
  {
    title: "Kết nối Facebook App & đồng bộ Pages",
    notifyOnPublish: false,
    body: `# Kết nối Facebook App & đồng bộ Pages

Để đăng bài lên trang Facebook, hệ thống cần quyền truy cập từ một **Facebook App** (ứng dụng trên nền tảng Meta for Developers). Mỗi App chỉ cấp token cho một số Page giới hạn, nên bạn có thể thêm **nhiều App** trong cùng workspace.

## Bước 1 — Tạo Facebook App (nếu chưa có)

1. Vào [Meta for Developers](https://developers.facebook.com) → **My Apps** → **Create App**.
2. Chọn loại **Business** (hoặc Page) để có quyền quản lý trang.
3. Thêm sản phẩm **Facebook Login** và **Pages** vào App.
4. Trong phần **App Settings → Basic**, ghi lại **App ID** và **App Secret** (Secret chỉ hiện khi bấm Show).
5. Trong **Advanced Settings**, bật **Require app secret for API access** nếu muốn bảo mật hơn.

## Bước 2 — Thêm App vào hệ thống

1. Vào trang [Facebook Apps](/facebook-apps) → **➕ Thêm Facebook App**.
2. Nhập: tên gợi nhớ (ví dụ "App Shop Chính"), **App ID**, **App Secret**, Graph API Version (mặc định v21.0).
3. Bấm **Thêm App**.

## Bước 3 — Lấy User Access Token và đồng bộ Pages

1. Trong thẻ App vừa tạo, ở khối **Đồng bộ Pages**: dán **User Access Token**.
2. Token cần có ít nhất 3 quyền: \`pages_show_list\`, \`pages_manage_posts\`, \`pages_read_engagement\`.
3. Bấm **🔄 Đồng bộ Pages**. Hệ thống sẽ:
   - Tự đổi token sang **long-lived** (~60 ngày) bằng App ID/Secret của đúng App đó.
   - Kéo danh sách các Page mà App này cấp quyền về DB (kèm Page Access Token của từng Page).
   - Từ nay mọi bài đăng đều dùng đúng App đã đồng bộ Page đó.

## Token hết hạn thì sao?

- Khi token sắp hết hạn (≤ 7 ngày), hệ thống sẽ cảnh báo ngay trên trang Facebook Apps và trong thông báo.
- Bạn chỉ cần dán token mới vào đúng form Đồng bộ Pages của App đó rồi bấm đồng bộ lại.
- Token long-lived có thời hạn ~60 ngày — lâu hơn nhiều token tạm 2 giờ.

## Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| Invalid OAuth access token | Token sai hoặc hết hạn | Lấy token mới từ Meta for Developers → Token Debugger |
| Error validating access token | Thiếu quyền pages_* | Tạo token mới với đủ 3 quyền pages |
| No pages returned | App chưa được duyệt quyền Page | Kiểm tra trạng thái App trên Meta (Live mode) |`,
  },
  {
    title: "Cấu hình AI & Pexels",
    notifyOnPublish: false,
    body: `# Cấu hình AI & Pexels

Hệ thống dùng **AI** để viết nội dung bài đăng và **Pexels** để tìm ảnh/video. Cả hai cấu hình ở trang [Cài đặt](/settings), riêng cho từng người dùng (không dùng chung).

## 1. AI Provider (OpenAI-compatible)

Hỗ trợ mọi provider tương thích chuẩn OpenAI (OpenAI, DeepSeek, OpenRouter, LM Studio, các proxy tự dựng...).

1. **Base URL** — nhập tới phần \`/v1\` (ví dụ \`https://api.openai.com/v1\`).
2. **API Key** — dán key của provider.
3. Bấm **⬇ Tải danh sách model** — hệ thống gọi \`GET {BaseURL}/models\` bằng đúng key bạn nhập.
4. Chọn model từ dropdown (có thể gõ để tìm nhanh).
5. Bấm **Lưu & Kiểm tra kết nối** — gửi một request chat rất nhỏ để xác nhận model chạy được thật.

> Nếu provider không hỗ trợ endpoint \`/models\`, bạn vẫn gõ tay được tên model.

## 2. Pexels API

1. Đăng ký miễn phí tại [pexels.com/api](https://www.pexels.com/api/).
2. Dán **API Key** vào form Pexels trong trang Cài đặt.
3. Bấm **Lưu & Kiểm tra kết nối** để xác nhận key hoạt động.

Pexels cung cấp kho ảnh/video chất lượng cao, miễn phí thương mại. Hệ thống có **bộ nhớ ảnh đã dùng** để tránh đăng trùng lặp một vài tấm ảnh giống nhau giữa các bài.

## 3. Bảo mật

- Mọi key được **mã hóa AES-256-GCM** trước khi lưu vào DB.
- Giao diện chỉ hiển thị dạng mask (\`sk-1••••••••cdef\`) cho key bí mật.
- Bỏ trống ô key khi sửa = giữ nguyên giá trị đã lưu.

## 4. Khi thiếu cấu hình thì sao?

- AI chưa cấu hình → nút **Sinh nội dung** báo lỗi và bạn vẫn soạn tay được.
- Pexels chưa cấu hình → khối tìm ảnh hiển thị hướng dẫn, bài vẫn đăng dạng chỉ có chữ được.`,
  },
  {
    title: "Soạn bài với AI",
    notifyOnPublish: false,
    body: `# Soạn bài với AI

Trang [Soạn bài](/composer) là trung tâm sáng tạo: AI viết nội dung theo thương hiệu, bạn tinh chỉnh rồi đăng hoặc hẹn giờ.

## 1. Viết theo thương hiệu

1. Chọn **thương hiệu muốn viết** trong dropdown "Viết theo thương hiệu" (chọn Page thì thương hiệu của Page tự được chọn).
2. AI sẽ đọc **hồ sơ + trụ cột nội dung + kho tài liệu** của thương hiệu: ngành hàng, sản phẩm, khoảng giá, giọng điệu, điều cấm nhắc...
3. Nhờ đó bài viết đúng chất thương hiệu, **không bịa giá** hay cam kết bạn không cung cấp.

## 2. Sinh nội dung

1. Nhập **chủ đề/ý tưởng** bài đăng.
2. Chọn **giọng điệu**: thân thiện, chuyên nghiệp, sôi nổi, truyền cảm hứng, hài hước.
3. Chọn **mục tiêu**: tăng tương tác, bán hàng, nhận diện thương hiệu, chia sẻ kiến thức.
4. Chọn **độ dài**: ngắn, trung bình, dài.
5. Tùy chọn thêm: **đối tượng độc giả**, **từ khóa cần có** (AI đưa vào bài một cách tự nhiên).
6. Bấm **✨ Sinh nội dung** → nhận **2–3 phương án** khác nhau về góc tiếp cận.
7. Bấm **Dùng phương án này** để đưa vào trình soạn thảo, chỉnh sửa tùy ý.

## 3. Tìm ảnh/video nhanh

Trong trình soạn thảo có khối **"Tìm ảnh/video nhanh trên Pexels"**:

- Gõ từ khóa (ưu tiên tiếng Anh: \`curtain\`, \`milk tea\`) + chọn Ảnh hoặc Video → **🔍 Tìm**.
- **✨ Gợi ý từ khóa** — AI đọc nội dung bài + ngành hàng rồi gợi ý các từ khóa (bấm chip để tìm ngay).
- Hover thumbnail rồi bấm **➕** để đính kèm. Không được trộn ảnh và video trong cùng một bài (giới hạn của Facebook).
- Cần tìm nhiều trang / lưu vào thư viện → bấm **🖼️ Chọn ảnh/video từ Pexels**.

## 4. Đăng hoặc hẹn giờ

- **Đăng ngay** — bài lên Facebook tức thì (dùng Page Access Token đã đồng bộ).
- **Hẹn giờ** — chọn ngày giờ; hệ thống tự đăng đúng giờ, kể cả khi bạn đóng trình duyệt.
- Ô nội dung hiển thị **số ký tự** và cảnh báo khi dòng đầu vượt ~125 ký tự (ngưỡng Facebook cắt phần "Xem thêm").

## 5. Mẹo cho bài chất lượng

- Dòng đầu tiên là "hook" — viết thật cuốn hút vì Facebook cắt sau ~125 ký tự.
- Kho tài liệu thương hiệu càng đầy đủ (bảng giá, FAQ, chính sách), AI càng ít phải đoán.
- Đọc lại phương án AI sinh trước khi đăng — AI hỗ trợ, bạn quyết định.`,
  },
  {
    title: "AutoPilot — tự động đăng bài",
    notifyOnPublish: false,
    body: `# AutoPilot — tự động đăng bài

**AutoPilot** là chế độ lái tự động: hệ thống tự lập kế hoạch, gọi AI viết bài theo trụ cột nội dung, tự tìm ảnh/video và tạo bài hẹn giờ — bạn chỉ cần bật một lần.

## 1. Bật AutoPilot

Vào trang [Tự động đăng](/autopilot) → chọn Page → bật **AutoPilot**.

## 2. Thông số cần đặt

| Thông số | Ý nghĩa |
|---|---|
| **Số bài/ngày** | Mỗi ngày hệ thống tạo mấy bài |
| **Khung giờ** | Từ giờ nào đến giờ nào trong ngày (ví dụ 07:00–21:00) |
| **Ngày trong tuần** | Thứ nào được đăng (1=Thứ Hai … 7=Chủ Nhật) |
| **Khoảng cách tối thiểu** | Giãn cách giữa 2 bài để tránh spam |
| **Lên kế hoạch trước** | Hệ thống lập kế hoạch cho mấy ngày tới |

## 3. Chế độ AUTO vs REVIEW

- **REVIEW** (khuyên dùng khi mới bắt đầu): AutoPilot tạo bài ở trạng thái **chờ duyệt**. Bạn vào trang AutoPilot xem danh sách, sửa nếu cần, bấm duyệt — bài mới được xếp lịch đăng. Mỗi lần có bài chờ duyệt bạn sẽ nhận **thông báo**.
- **AUTO**: bài tạo xong tự động xếp lịch và đăng luôn khi tới giờ — hoàn toàn tự động.

## 4. Media tự động

- **Ảnh duy nhất**: mọi bài dùng ảnh Pexels.
- **Video duy nhất**: mọi bài dùng video.
- **Trộn**: luân phiên theo % video bạn đặt (Facebook không cho đăng chung ảnh + video trong một bài).
- Bộ chọn media **loại trừ ảnh đã dùng** trong 60 ngày gần đây để trang không lặp lại vài tấm giống nhau.

## 5. Xoay vòng trụ cột nội dung

AutoPilot đọc **trọng số trụ cột** (trang [Thương hiệu](/brand)) để chọn loại bài cho mỗi slot: ví dụ trụ cột "Giới thiệu sản phẩm" 50% thì nửa số bài trong kỳ sẽ thuộc trụ cột đó. Nhờ vậy trang không nhàm chán.

## 6. Theo dõi & xử lý lỗi

- Mỗi lần lập kế hoạch: **số bài tạo ra** và **lỗi (nếu có)** hiện ngay trong trang AutoPilot.
- Lỗi AI/Pexels được ghi vào \`lastPlanError\` và gửi thông báo — bài vẫn được tạo dạng chỉ có chữ nếu không tìm được ảnh.
- Bài đến giờ đăng mà lỗi sẽ **tự thử lại** với backoff (chờ tăng dần), tối đa vài lần; thất bại hẳn sẽ có thông báo.

## 7. Tạm dừng

Tắt AutoPilot bất cứ lúc nào — cấu hình vẫn giữ để bật lại. Bài đã xếp lịch vẫn nằm chờ (không mất), bật lại là chạy tiếp.`,
  },
  {
    title: "Thương hiệu & nội dung chuẩn",
    notifyOnPublish: false,
    body: `# Thương hiệu & nội dung chuẩn

Hồ sơ thương hiệu là nơi bạn mô tả doanh nghiệp **MỘT LẦN** — mọi nội dung AI viết ra (thủ công lẫn AutoPilot) đều dựa trên hồ sơ này.

## 1. Tạo thương hiệu

Vào trang [Thương hiệu](/brand) → tạo thương hiệu mới trong workspace. Một thương hiệu có thể gắn với nhiều Page.

## 2. Hồ sơ thương hiệu — điền gì?

| Trường | Ý nghĩa | Ví dụ |
|---|---|---|
| **Tên / Tagline** | Tên thương hiệu + câu định vị | "Rèm Cửa ABC — Đẹp cho mọi không gian" |
| **Ngành hàng** | Lĩnh vực hoạt động | "Nội thất — rèm cửa, giấy dán tường" |
| **Sản phẩm** | Mỗi dòng một sản phẩm/dịch vụ | "Rèm vải hai lớp; Rèm roman; Giấy dán tường" |
| **USP** | Điểm khác biệt so với đối thủ | "Miễn phí đo tại nhà; bảo hành 3 năm" |
| **Khoảng giá** | AI dùng để **không bịa giá** | "Rèm vải 250k–600k/m" |
| **Khách hàng mục tiêu** | AI viết đúng đối tượng | "Gia đình trẻ 25–40 tuổi, nhà phố" |
| **Giọng điệu** | friendly / professional / exciting / inspiring / humorous | |
| **Điều CẤM nhắc** | Chủ đề tuyệt đối tránh | "Không nhắc đối thủ; không hứa giá rẻ nhất" |
| **CTA quen thuộc** | Câu kêu gọi hành động | "Inbox ngay để được tư vấn miễn phí" |
| **Hashtag luôn dùng** | Gắn sẵn vào mọi bài | #remcua #noithat |
| **Bài viết mẫu** | Vài bài cũ để AI bắt chước văn phong | |

## 3. Trụ cột nội dung

Trụ cột = các "loại bài" xoay vòng để trang không nhàm chán. Ví dụ:

1. **Giới thiệu sản phẩm** (trọng số 40%)
2. **Kiến thức / mẹo** (30%)
3. **Khuyến mãi** (15%)
4. **Câu chuyện khách hàng** (15%)

Mỗi trụ cột có: tên, mô tả cách viết, mục tiêu (engagement/sales/awareness/education), trọng số %, bật/tắt. AutoPilot dùng trọng số để chọn trụ cột cho mỗi slot đăng.

## 4. Kho tài liệu

Thêm bảng giá, FAQ, chính sách, câu chuyện thương hiệu... AI sẽ **đọc tài liệu liên quan** khi viết bài:

- Bài về giá → AI tham chiếu đúng bảng giá, không bịa số.
- Bài FAQ → AI trả lời đúng chính sách thật.

Tài liệu thuộc **thương hiệu** (không thuộc Page) — dùng chung cho mọi Page cùng thương hiệu.

## 5. Gán thương hiệu cho Page

Ở trang [Facebook Pages](/pages), mỗi Page có thể gán vào một thương hiệu. Page được gán thương hiệu thì bài viết của Page luôn dùng đúng hồ sơ đó.`,
  },
  {
    title: "Lịch đăng & lịch sử đăng bài",
    notifyOnPublish: false,
    body: `# Lịch đăng & lịch sử đăng bài

Hai trang theo dõi mọi bài viết: [Lịch đăng](/calendar) cho kế hoạch tương lai, [Lịch sử](/history) cho bài đã đăng.

## 1. Lịch đăng — Calendar

- Hiển thị bài theo ngày dạng bảng, gồm bài hẹn giờ, bài chờ duyệt (AutoPilot REVIEW), bài đang đăng.
- Kéo thả bài để đổi ngày/giờ đăng (nếu bật).
- Nút **⏸ Tắt tự động đăng** / **▶ Bật tự động đăng** ở đầu trang — công tắc cấp hệ thống.
- Nút **🔄 Chạy ngay** — chạy một vòng scheduler ngay lập tức thay vì chờ nhịp 60 giây kế tiếp.

## 2. Trạng thái bài

| Trạng thái | Ý nghĩa |
|---|---|
| **DRAFT** | Bản nháp — chưa xếp lịch |
| **PENDING_REVIEW** | Chờ bạn duyệt (bài do AutoPilot REVIEW tạo) |
| **SCHEDULED** | Đã xếp lịch, chờ tới giờ đăng |
| **PUBLISHING** | Worker đang đăng lên Facebook |
| **PUBLISHED** | Đăng thành công — kèm link bài trên Facebook |
| **FAILED** | Đăng thất bại — xem lỗi ở cột chi tiết |

## 3. Tự động thử lại khi lỗi

Bài đăng lỗi tạm thời (mạng chập chờn, rate limit) sẽ **tự thử lại** với backoff: lần 1 sau ~1 phút, lần 2 sau ~5 phút, lần 3 sau ~15 phút. Lỗi vĩnh viễn (token hết hạn, bài bị Facebook từ chối) sẽ không thử lại và báo rõ lý do.

## 4. Lịch sử — History

- Bảng toàn bộ bài đã đăng, kèm trạng thái, giờ đăng, Page, lỗi (nếu có).
- Tìm kiếm theo nội dung, lọc theo trạng thái/Page.
- Bài FAILED có nút **Thử lại** để đăng lại ngay.
- Bài PUBLISHED có link mở trên Facebook để kiểm tra.

## 5. Vòng lặp tự động đăng

Bài hẹn giờ được đăng bởi **vòng lặp chạy trong chính web server** (kiểm tra mỗi 60 giây) — không cần mở terminal hay cài thêm gì. Chỉ cần app đang chạy là bài được đăng đúng giờ, kể cả khi bạn đóng trình duyệt.

Bạn có thể tắt/bật vòng lặp ở **Lịch đăng** hoặc **Cài đặt → Tự động đăng bài theo lịch**. Khi tắt, bài hẹn giờ nằm chờ và sẽ đăng ngay khi bật lại (nếu quá giờ).`,
  },
  {
    title: "Câu hỏi thường gặp (FAQ)",
    notifyOnPublish: false,
    body: `# Câu hỏi thường gặp (FAQ)

## Tài khoản & quyền

**Q: Đăng ký xong bao lâu được dùng?**
A: Admin duyệt là dùng được ngay. Bạn đăng nhập bằng **mật khẩu đã đăng ký** — hệ thống không cấp mật khẩu tạm khi duyệt.

**Q: Quên mật khẩu thì sao?**
A: Liên hệ admin. Admin đặt mật khẩu tạm mới; lần đăng nhập kế tiếp bạn buộc đổi sang mật khẩu của mình.

**Q: Nhiều người dùng có dùng chung tài khoản được không?**
A: Nên mỗi người một tài khoản. Hệ thống hỗ trợ **workspace** — mỗi người có góc làm việc riêng, và một workspace có nhiều thành viên với các vai trò (OWNER/ADMIN/EDITOR/VIEWER).

## Facebook

**Q: Tại sao một workspace thêm được nhiều Facebook App?**
A: Một Facebook App chỉ cấp token cho một số Page giới hạn. Thêm nhiều App để lấy được các nhóm Page khác nhau. Mỗi Page nhớ đúng App đã cấp token cho nó.

**Q: Token hết hạn có mất bài không?**
A: Không. Bài hẹn giờ nằm chờ; sau khi dán token mới và đồng bộ lại, bài quá giờ sẽ được đăng tiếp.

**Q: Một Page xuất hiện qua 2 App thì sao?**
A: Hệ thống giữ bản ghi gốc theo (workspace, fbPageId) — không tạo trùng. Bạn có thể chuyển Page sang App khác trong trang Facebook Pages.

## AI & Pexels

**Q: AI có bịa giá/số liệu không?**
A: Prompt ràng buộc AI **không bịa số liệu, giá cả hay cam kết** bạn không cung cấp. Điền khoảng giá trong hồ sơ thương hiệu để AI dùng đúng.

**Q: Pexels hết quota thì sao?**
A: Quota miễn phí của Pexels khá rộng. Khi hết, hệ thống báo lỗi tìm ảnh — bài vẫn tạo được dạng chỉ có chữ, hoặc bạn đính kèm ảnh từ thư viện Media.

**Q: Có dùng được AI tự dựng (Ollama, LM Studio) không?**
A: Được — mọi provider tương thích OpenAI: nhập Base URL tới \`/v1\` + key (key bất kỳ nếu server không cần).

## Đăng bài

**Q: Tại sao bài FAILED?**
A: Xem cột lỗi ở Lịch sử. Thường gặp: token hết hạn, thiếu quyền Page, nội dung bị Facebook từ chối (link spam, từ khóa nhạy cảm). Sửa xong bấm Thử lại.

**Q: Đăng video có khác gì ảnh không?**
A: Video cần upload lên Facebook trước rồi mới tạo bài (hệ thống tự xử lý). Không đăng chung ảnh + video trong một bài.

**Q: Muốn đăng lại bài cũ thì sao?**
A: Mở bài trong Lịch sử → nhân bản/sửa → xếp lịch mới. Hệ thống không tự đăng lại bài cũ.

## Hệ thống

**Q: Đóng trình duyệt thì bài hẹn giờ có đăng không?**
A: Có. Vòng lặp tự động đăng chạy trong **tiến trình server**, không phụ thuộc trình duyệt.

**Q: Muốn dừng mọi bài tự động?**
A: Tắt AutoPilot (ngừng tạo bài mới) và/hoặc tắt tự động đăng theo lịch (bài đã xếp nằm chờ). Cả hai đều giữ nguyên dữ liệu.`,
  },
];

const questions = [
  "Bạn thường gặp khó khăn nhất ở bước nào khi dùng hệ thống? (kết nối Facebook, cấu hình AI, viết bài, hẹn giờ...)",
  "Bạn muốn hệ thống bổ sung tính năng gì tiếp theo?",
];

function main() {
  const insertDoc = db.prepare(`
    INSERT INTO Doc (id, title, slug, bodyMarkdown, published, notifyOnPublish, authorId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))
  `);
  const updateDoc = db.prepare(`
    UPDATE Doc SET title = ?, bodyMarkdown = ?, published = 1, updatedAt = datetime('now')
    WHERE slug = ?
  `);

  let created = 0;
  let updated = 0;
  for (const d of docs) {
    const slug = slugify(d.title);
    const existing = db.prepare("SELECT id FROM Doc WHERE slug = ?").get(slug);
    if (existing) {
      updateDoc.run(d.title, d.body, slug);
      updated++;
      console.log(`= cập nhật: ${slug}`);
    } else {
      insertDoc.run(randomUUID(), d.title, slug, d.body, d.notifyOnPublish ? 1 : 0, author.id);
      created++;
      console.log(`+ tạo mới: ${slug}`);
    }
  }

  const insertQ = db.prepare(`
    INSERT INTO FeedbackQuestion (id, question, active, authorId, createdAt, updatedAt)
    VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))
  `);
  let qCreated = 0;
  for (const q of questions) {
    const dup = db.prepare("SELECT id FROM FeedbackQuestion WHERE question = ?").get(q);
    if (!dup) {
      insertQ.run(randomUUID(), q, author.id);
      qCreated++;
      console.log(`+ câu hỏi: ${q.slice(0, 60)}...`);
    }
  }

  console.log(`\nHoàn tất: ${created} doc mới, ${updated} doc cập nhật, ${qCreated} câu hỏi mới.`);
}

main();
db.close();
