// ============================================================
// Seed docs hướng dẫn mặc định + câu hỏi mẫu (idempotent).
//
// Chạy: npm run db:seed-docs
// - Upsert theo slug: có thì cập nhật nội dung, chưa có thì tạo.
// - Mọi doc đều published để user đọc được ngay tại /docs.
// - Cần DB đã có ít nhất 1 user ADMIN (làm authorId).
//
// Dùng PostgreSQL (Supabase) qua DATABASE_URL.
// ============================================================

import "dotenv/config";
import pg from "pg";
import { randomUUID } from "node:crypto";

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!connectionString) {
  console.error("✗ Thiếu DATABASE_URL — kiểm tra file .env");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

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
2. Nhập: tên gợi nhớ (ví dụ "App Shop Chính"), **App ID**, **App Secret**, Graph API Version (mặc định v25.0).
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

## 4. Tải ảnh/video từ máy lên

Ngoài Pexels, bạn có thể đính kèm file trong máy:

- **Tối đa 50MB mỗi file.** Video dài/nặng hơn nên nén lại trước khi tải.
- File được đưa **thẳng lên kho lưu trữ** (Supabase Storage) chứ không chạy qua server, nên tải nhanh và không bị giới hạn dung lượng của nền tảng hosting.
- Video tải lên xem lại được ngay trong trình soạn thảo. Khi đăng, Facebook tự tải video về từ kho — bạn không phải chờ.
- Nếu tải lên báo lỗi định dạng, dùng file \`.mp4\` (H.264) hoặc \`.mov\`.

## 5. Đăng hoặc hẹn giờ

- **Đăng ngay** — bài lên Facebook tức thì (dùng Page Access Token đã đồng bộ).
- **Hẹn giờ** — chọn ngày giờ; hệ thống tự đăng đúng giờ, kể cả khi bạn đóng trình duyệt.
- Ô nội dung hiển thị **số ký tự** và cảnh báo khi dòng đầu vượt ~125 ký tự (ngưỡng Facebook cắt phần "Xem thêm").

## 6. Mẹo cho bài chất lượng

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
    title: "Ảnh/video từ Google Drive cá nhân",
    notifyOnPublish: false,
    body: `# Ảnh/video từ Google Drive cá nhân

Hệ thống có **ba nguồn ảnh/video ngang hàng nhau**, bạn chọn tự do — thậm chí trộn trong cùng một bài:

| Nguồn | Lưu ở đâu | Phù hợp khi |
|---|---|---|
| 📁 **Google Drive cá nhân** | Drive của chính bạn (15 GB) | Bạn đã có ảnh sản phẩm, ảnh thật của shop |
| 🖼️ **Pexels** | Kho ảnh miễn phí bản quyền | Chưa có ảnh, cần ảnh đẹp nhanh |
| ⏫ **Tải từ máy** | Kho tệp của hệ thống | Ảnh/video lẻ, dùng một lần |

Ảnh thật của shop thường hiệu quả hơn ảnh stock, mà Drive của bạn thì dung lượng tính theo tài khoản của bạn — nên đây là nguồn đáng dùng nhất.

## 1. Kết nối Google Drive (quản trị viên làm một lần)

Cần một **OAuth Client** trên Google Cloud:

1. Vào [console.cloud.google.com](https://console.cloud.google.com) → tạo project.
2. **APIs & Services → Library**: bật **Google Drive API** và **Google Picker API**.
3. **OAuth consent screen**: chọn loại *External*; thêm scope \`.../auth/drive.file\` (và \`openid\`, \`email\`, \`profile\`); thêm email người dùng vào mục **Test users**.
   - App chỉ xin quyền \`drive.file\`: **chỉ đọc được tệp bạn tự chọn**, không xem được cả Drive. Nhờ vậy không phải qua quy trình xác minh ngặt nghèo của Google.
   - Ở chế độ *Testing*, Google giới hạn 100 người dùng và refresh token hết hạn sau **7 ngày** — khi đó bấm **Cấp quyền lại** trong Cài đặt.
4. **Credentials → Create credentials → OAuth client ID** (loại *Web application*), thêm Authorized redirect URI đúng bằng giá trị \`GOOGLE_OAUTH_REDIRECT_URI\`.
5. **Credentials → Create credentials → API key** cho Google Picker.
6. Điền vào \`.env\`: \`GOOGLE_OAUTH_CLIENT_ID\`, \`GOOGLE_OAUTH_CLIENT_SECRET\`, \`GOOGLE_OAUTH_REDIRECT_URI\`, \`GOOGLE_PICKER_API_KEY\` rồi khởi động lại app.

## 2. Mỗi người dùng tự kết nối

Vào [Cài đặt](/settings) → mục **Google Drive cá nhân** → bấm **Kết nối Google Drive** và đồng ý cấp quyền. Mỗi người dùng dùng Drive của chính mình; ảnh không đi qua dung lượng của hệ thống.

## 3. Gắn thư mục cho từng thương hiệu

Vào [Thương hiệu](/brand) → chọn thương hiệu → mở khối **Ảnh/video từ Google Drive** → **Chọn thư mục trên Drive**.

Tạo trên Drive một thư mục cho mỗi thương hiệu, ví dụ \`Ảnh — Cửa hàng A\`, rồi chọn đúng thư mục đó. Hệ thống lấy ảnh **trực tiếp trong thư mục đó**.

> Vì App chỉ được cấp quyền với tệp do bạn chọn, bước chọn thư mục là **bắt buộc** — không có cách nào khác để app biết dùng ảnh nào.

## 4. Dùng trong bài đăng

- **Soạn bài thủ công**: bấm **📁 Chọn từ Google Drive** để chọn ảnh/video, hoặc vào [Thư viện Media](/media) → tab **Google Drive** để xem thư mục và **Lưu vào thư viện**.
- **Trộn nguồn**: trong cùng một bài bạn có thể dùng 2 ảnh Drive + 2 ảnh Pexels. Facebook chỉ cấm trộn ảnh với video, không cấm trộn nguồn.
- **AutoPilot**: ở trang [Tự động đăng](/autopilot), mục **Lấy ảnh/video từ đâu?** chọn 📁 Google Drive; tick **Nếu nguồn chính hết ảnh thì lấy từ nguồn còn lại** để Drive trống thì tự chuyển sang Pexels (khuyến nghị bật).

## 5. Giới hạn cần biết

- **Video trên Drive tối đa 50MB** (giới hạn kho tạm của hệ thống). Video dài/nặng nên nén lại trước.
- Drive hết dung lượng thì hệ thống báo rõ và **không tự xoá gì** của bạn.
- Ảnh/video đi qua máy chủ để gửi lên Facebook (Facebook không đọc được link Drive riêng tư), nên nên dùng ảnh đã tối ưu, không cần ảnh gốc quá lớn.
- Nếu ngắt kết nối Drive, các Page đang dùng nguồn Drive sẽ **tự chuyển về Pexels** và bật dự phòng, để bài không bị thiếu ảnh.`,
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
- Nút **🔄 Chạy ngay** — chạy một vòng scheduler ngay lập tức thay vì chờ nhịp kế tiếp.

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

## 5. Điều gì đăng bài thay bạn?

Bài hẹn giờ được đăng bởi **worker chạy phía server** — bạn không cần mở trình duyệt, chỉ cần hệ thống đang chạy. Có hai cách chạy worker tuỳ nơi triển khai:

- **Tự chạy trong web server** (mặc định khi cài trên máy chủ riêng): vòng lặp kiểm tra bài đến hạn mỗi 60 giây.
- **Dùng cron ngoài** (khi deploy trên Vercel): serverless không giữ được vòng lặp, nên có một dịch vụ cron gọi vào hệ thống mỗi vài phút để đăng bài đến hạn. Phần này do người triển khai cấu hình — bạn không phải làm gì.

Nếu nghi ngờ worker không chạy, mở **Lịch đăng** và bấm **🔄 Chạy ngay**: bài đến hạn sẽ được xử lý ngay lập tức.

Bạn có thể tắt/bật tự động đăng ở **Lịch đăng** hoặc **Cài đặt → Tự động đăng bài theo lịch**. Khi tắt, bài hẹn giờ nằm chờ và sẽ đăng ngay khi bật lại (nếu đã quá giờ).`,
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
A: Video được tải lên kho lưu trữ rồi Facebook tự tải về khi đăng, nên bạn không phải chờ upload qua server. Giới hạn **50MB mỗi video** — file lớn hơn hãy nén lại. Không đăng chung ảnh + video trong một bài.

**Q: Video tải lên bị lỗi thì kiểm tra gì?**
A: Ba nguyên nhân thường gặp: (1) file vượt 50MB, (2) định dạng không phải \`.mp4\`/\`.mov\`, (3) mạng đứt giữa lúc tải — thử lại. Video đã tải lên nằm trong [Thư viện Media](/media) nên không phải tải lại từ đầu.

**Q: Muốn đăng lại bài cũ thì sao?**
A: Mở bài trong Lịch sử → nhân bản/sửa → xếp lịch mới. Hệ thống không tự đăng lại bài cũ.

## Hệ thống

**Q: Đóng trình duyệt thì bài hẹn giờ có đăng không?**
A: Có. Worker đăng bài chạy ở phía server (vòng lặp trong app, hoặc cron ngoài khi deploy trên Vercel) — hoàn toàn không phụ thuộc trình duyệt của bạn.

**Q: Bài đến giờ mà không thấy đăng?**
A: Mở [Lịch đăng](/calendar) bấm **🔄 Chạy ngay** để xử lý ngay. Kiểm tra thêm: công tắc tự động đăng có đang tắt không, và Page còn token hợp lệ không (xem [Facebook Apps](/facebook-apps)).

**Q: Muốn dừng mọi bài tự động?**
A: Tắt AutoPilot (ngừng tạo bài mới) và/hoặc tắt tự động đăng theo lịch (bài đã xếp nằm chờ). Cả hai đều giữ nguyên dữ liệu.`,
  },
];

const questions = [
  "Bạn thường gặp khó khăn nhất ở bước nào khi dùng hệ thống? (kết nối Facebook, cấu hình AI, viết bài, hẹn giờ...)",
  "Bạn muốn hệ thống bổ sung tính năng gì tiếp theo?",
];

async function main() {
  await client.connect();

  const { rows: admins } = await client.query(
    `SELECT id, email FROM "User" WHERE role = 'ADMIN' ORDER BY "createdAt" ASC LIMIT 1`
  );
  const author = admins[0];
  if (!author) {
    console.error("✗ Chưa có user ADMIN nào — chạy `npm run db:seed-admin` trước.");
    process.exit(1);
  }
  console.log(`Tác giả: ${author.email}\n`);

  let created = 0;
  let updated = 0;
  for (const d of docs) {
    const slug = slugify(d.title);
    const { rowCount } = await client.query('SELECT 1 FROM "Doc" WHERE slug = $1', [slug]);
    if (rowCount > 0) {
      await client.query(
        `UPDATE "Doc"
            SET title = $1, "bodyMarkdown" = $2, published = true,
                "notifyOnPublish" = $3, "updatedAt" = now()
          WHERE slug = $4`,
        [d.title, d.body, d.notifyOnPublish === true, slug]
      );
      updated++;
      console.log(`= cập nhật: ${slug}`);
    } else {
      await client.query(
        `INSERT INTO "Doc"
           (id, title, slug, "bodyMarkdown", published, "notifyOnPublish", "authorId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, true, $5, $6, now(), now())`,
        [randomUUID(), d.title, slug, d.body, d.notifyOnPublish === true, author.id]
      );
      created++;
      console.log(`+ tạo mới: ${slug}`);
    }
  }

  let qCreated = 0;
  for (const q of questions) {
    const { rowCount } = await client.query(
      'SELECT 1 FROM "FeedbackQuestion" WHERE question = $1',
      [q]
    );
    if (rowCount === 0) {
      await client.query(
        `INSERT INTO "FeedbackQuestion" (id, question, active, "authorId", "createdAt", "updatedAt")
         VALUES ($1, $2, true, $3, now(), now())`,
        [randomUUID(), q, author.id]
      );
      qCreated++;
      console.log(`+ câu hỏi: ${q.slice(0, 60)}...`);
    }
  }

  console.log(
    `\nHoàn tất: ${created} doc mới, ${updated} doc cập nhật, ${qCreated} câu hỏi mới.`
  );
}

main()
  .catch((err) => {
    console.error("✗ Lỗi seed docs:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
