# FB Marketing Auto

Web app tự động hóa đăng bài Facebook: **AI viết nội dung → tìm ảnh/video từ Pexels → đăng ngay hoặc hẹn giờ lên Facebook Page**.

Xem `PLAN.md` cho kế hoạch tổng thể 6 tuần.

## Đa Workspace · Đa Thương hiệu · Đa Facebook App

Hệ thống tổ chức theo tầng: **User → Workspace → Facebook App (Connection) → Page → Brand**.

- Một tài khoản có **nhiều Workspace** (góc làm việc tách biệt dữ liệu).
- Mỗi workspace thêm được **1 hoặc nhiều Facebook Graph API App** — vì một
  Facebook App chỉ cấp token cho một số Page giới hạn, thêm nhiều App để lấy
  được các nhóm Page khác nhau (trang `/facebook-apps`).
- Mỗi **Page nhớ đúng App** đã cấp token (`connectionId`) — đăng bài luôn dùng
  đúng phiên bản Graph API + App Secret của App đó; lỗi một App không ảnh
  hưởng App khác.
- Mỗi workspace quản lý **nhiều Brand**; một Brand có thể có nhiều Page;
  hồ sơ thương hiệu + trụ cột + kho tài liệu gắn theo Brand (dùng chung
  giữa các Page cùng thương hiệu).

## Tech stack

- **Next.js 16** (App Router, TypeScript, Tailwind CSS 4, Turbopack)
- **Prisma 7 + SQLite** (driver adapter `better-sqlite3`) — chuyển PostgreSQL khi deploy
- **Auth**: JWT session (jose) + cookie httpOnly, guard bằng `proxy.ts` (Next 16 thay cho middleware)
- Tích hợp kế tiếp: AI (OpenAI-compatible), Pexels API, Facebook Graph API, BullMQ + Redis

## Cài đặt & chạy

```bash
# 1. Cài dependencies
npm install

# 2. Cấu hình môi trường
cp .env.example .env
# → sửa SESSION_SECRET (tạo bằng: openssl rand -base64 32)

# 3. Tạo DB + Prisma Client
npx prisma migrate dev

# 4. Chạy dev server
npm run dev
```

Mở http://localhost:3000 — lần đầu sẽ được chuyển tới **/setup** để tạo tài khoản admin.

## Quản trị tài khoản (hệ thống riêng tư)

App chỉ mở cho người dùng được admin cấp quyền:

- **Admin hệ thống**: tạo sẵn bằng `npm run db:seed-admin`
  (mặc định `nms2772k2@gmail.com` / `Admin@123` — **lần đăng nhập đầu bắt buộc đổi mật khẩu**).
- **Đăng ký**: người vào `/register` gửi đăng ký → tài khoản ở trạng thái **Chờ duyệt**,
  chưa đăng nhập được.
- **Duyệt**: admin vào **🛡️ Quản trị** (`/admin`) → bấm **Duyệt**, đặt **mật khẩu tạm**
  (gợi ý `Abc@12345`) → gửi cho người dùng. Họ **bắt buộc đổi mật khẩu** ở lần đăng nhập đầu.
- **Từ chối/Khoá**: chặn đăng nhập, giữ nguyên dữ liệu — mở lại được bất cứ lúc nào.
- **Reset mật khẩu**: cấp mật khẩu tạm mới khi người dùng quên.
- **Xoá hẳn**: phá hủy toàn bộ dữ liệu của user (confirm 2 bước) — cân nhắc dùng Khoá thay thế.
- **Tạo tài khoản trực tiếp**: admin cấp tài khoản cho người khác mà không cần họ đăng ký.
- Khi **duyệt** hoặc **reset mật khẩu**, admin đặt mật khẩu tạm (không dùng lại mật khẩu
  người đăng ký tự chọn) → người dùng buộc đổi ngay lần đăng nhập đầu. Khi chỉ **mở lại**
  tài khoản bị khoá, mật khẩu cũ được giữ nguyên — không buộc đổi.

| Lệnh | Mục đích |
|---|---|
| `npm run db:seed-admin` | Tạo admin hệ thống + chuẩn hóa trạng thái user cũ |
| `npm run test:admin` | Test luồng quản trị (21 check, chạy trên test.db) |

## Các lệnh hữu ích

| Lệnh | Mục đích |
|---|---|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Build production |
| `npm run lint` | Kiểm tra ESLint |
| `npx prisma studio` | GUI xem/sửa dữ liệu |
| `npx prisma migrate dev` | Tạo/áp dụng migration sau khi sửa `prisma/schema.prisma` |

## Cấu trúc thư mục

```
src/
├── app/
│   ├── (auth)/            # /login, /register, /setup, /change-password
│   ├── (dashboard)/       # Trang private (dashboard, composer, brand, autopilot, media, history, calendar, facebook-apps, pages, settings, admin)
│   ├── api/uploads/       # Route Handler nhận/phát/xóa file video upload
│   ├── api/cron/tick/     # Endpoint cho worker/cron chạy một vòng scheduler
│   ├── actions/           # Server Actions: auth, admin, settings, pages, composer, media, publish, history, schedule, brand, autopilot
│   └── proxy.ts           # Guard redirect (Next 16 — thay cho middleware.ts)
├── components/            # UI dùng chung (composer-studio, media-browser, brand-editor, autopilot-dashboard...)
├── lib/
│   ├── prisma.ts          # Prisma Client singleton (better-sqlite3 adapter)
│   ├── session.ts         # JWT session encrypt/decrypt + cookie
│   ├── dal.ts             # getCurrentUser / requireCurrentUser + workspace context (membership/role)
│   ├── settings.ts        # Đọc/ghi cấu hình tích hợp (mã hóa AES-256-GCM)
│   ├── facebook-connection.ts # CRUD Facebook App trong workspace (nhiều App/ws)
│   ├── ai.ts              # Gọi AI provider: /models, /chat/completions, sinh nội dung
│   ├── ai-prompts.ts      # Prompt template + giọng điệu/mục tiêu/độ dài + parse JSON
│   ├── pexels.ts          # Pexels client: tìm ảnh/video, cache quota (server-only)
│   ├── instrumentation.ts # Khởi động vòng lặp tự động đăng khi server chạy
│   ├── uploads.ts         # Lưu/xóa/dọn file video upload (server-only)
│   ├── deliver.ts         # Gửi bài + media lên Facebook (dùng chung publish & scheduler)
│   ├── scheduler.ts       # Worker: giành bài đến hạn, đăng, retry backoff (server-only)
│   ├── brand.ts           # Nạp hồ sơ thương hiệu + chọn tài liệu liên quan cho prompt (server-only)
│   ├── autopilot.ts       # Bộ lập kế hoạch: chọn trụ cột, gọi AI, tìm ảnh, tạo bài (server-only)
│   ├── autopilot-plan.ts  # Logic thuần: chia khung giờ, xoay vòng trụ cột (có unit test)
│   ├── pexels-types.ts    # Kiểu dữ liệu media dùng chung client + server
│   ├── posts.ts           # Helper thuần: đính kèm, validate ảnh/video, badge trạng thái
│   └── facebook.ts        # Facebook Graph API client (token, Pages, đăng bài)
└── generated/prisma/      # Prisma Client (generate, không commit)
prisma/
├── schema.prisma          # Models: Workspace, WorkspaceMember, FacebookConnection, Brand,
│                          #         FacebookPage, Post, Media, AppSetting, BrandProfile,
│                          #         ContentPillar, KnowledgeDoc, AutoPilot, UsedMedia, User
└── migrations/
```

## Cấu hình tích hợp (trang Cài đặt)

Toàn bộ API key được nhập **trực tiếp trên web** tại `/settings` — không cần sửa `.env`:

| Tích hợp | Trường cần nhập |
|---|---|
| AI Provider (OpenAI-compatible) | **Base URL + API Key** — danh sách model tự tải về |
| Pexels API | API Key ([đăng ký miễn phí](https://www.pexels.com/api/)) |

Cấu hình **Facebook Graph API** không còn ở trang Cài đặt — đã chuyển sang trang **Facebook Apps** (`/facebook-apps`) theo từng workspace, thêm được nhiều App (mỗi App lấy một nhóm Page).

### AI Provider — model tự tải, không cần gõ tay

1. Nhập **Base URL** (tới phần `/v1`) + **API Key**.
2. Bấm **⬇ Tải danh sách model** (hoặc **Lưu** — hệ thống tự tải sau khi lưu).
   App gọi `GET {Base URL}/models` bằng đúng key bạn nhập để lấy danh sách model.
3. Chọn model từ dropdown (gõ để tìm nhanh nếu provider có nhiều model) → **Lưu & Kiểm tra kết nối**.

Khi mở lại trang Cài đặt, danh sách model được tải sẵn từ server nên bạn chọn được ngay.
Nút **Lưu & Kiểm tra kết nối** còn gửi một request chat rất nhỏ tới model đã chọn để xác nhận
model chạy được thật (trả về cả nội dung phản hồi và số token đã dùng).

> Nếu provider không hỗ trợ endpoint `/models`, ô Model vẫn cho phép gõ tay tên model.

### Các ô cấu hình khác

- Mỗi form có **Chỉ lưu** và **Lưu & Kiểm tra kết nối** (gọi thật tới dịch vụ để xác nhận key hoạt động).
- Giá trị được **mã hóa AES-256-GCM** (khóa suy từ `SESSION_SECRET`) trước khi ghi vào bảng `AppSetting`.
- UI chỉ hiển thị dạng mask (`sk-1••••••••cdef`) cho key bí mật; bỏ trống ô key = giữ nguyên giá trị đã lưu.
- Nếu DB chưa có giá trị, hệ thống fallback về biến môi trường tương ứng trong `.env`.

## AI viết nội dung (trang Soạn bài)

Vào `/composer`:

1. Chọn **thương hiệu muốn viết** (dropdown "Viết theo thương hiệu"). Chọn Page
   thì thương hiệu của Page tự được chọn; bạn có thể đổi hoặc để "Không dùng
   hồ sơ thương hiệu". Khi chọn brand, AI đọc **hồ sơ + trụ cột + kho tài liệu**
   của thương hiệu đó (ngành hàng, sản phẩm, khoảng giá, giọng điệu, điều cấm
   nhắc...) — bài viết đúng chất thương hiệu, không bịa giá.
2. Nhập **chủ đề/ý tưởng** bài đăng.
3. Chọn **giọng điệu** (thân thiện, chuyên nghiệp, sôi nổi, truyền cảm hứng, hài hước),
   **mục tiêu** (tăng tương tác, bán hàng, nhận diện thương hiệu, chia sẻ kiến thức) và **độ dài**.
4. Tùy chọn thêm **đối tượng độc giả** và **từ khóa cần có** — AI sẽ đưa các từ khóa vào bài một cách tự nhiên.
5. Bấm **✨ Sinh nội dung** → AI trả về **2–3 phương án khác nhau về góc tiếp cận**.
6. Bấm **Dùng phương án này** để đưa vào trình soạn thảo, chỉnh sửa lại tùy ý.

Prompt template nằm ở `src/lib/ai-prompts.ts`. AI được yêu cầu trả về JSON, và bộ parse
chấp nhận nhiều biến thể (mảng trần, `posts`/`options`, có/không bọc markdown) — nếu model
trả về văn bản thuần thì vẫn dùng được nguyên bài thay vì báo lỗi.
Prompt cũng ràng buộc **không bịa số liệu, giá cả hay cam kết** mà bạn không cung cấp.

Ô nội dung hiển thị **số ký tự** và cảnh báo khi dòng đầu vượt ~125 ký tự (ngưỡng Facebook
cắt phần "Xem thêm").

### Tìm ảnh/video Pexels ngay trên bài viết

Trong trình soạn thảo có khối **"Tìm ảnh/video nhanh trên Pexels"**:

- Gõ từ khóa (ưu tiên tiếng Anh, ví dụ `curtain`, `milk tea`) + chọn **Ảnh** hoặc **Video** → bấm **🔍 Tìm**.
- **✨ Gợi ý từ khóa** — AI đọc nội dung bài viết + ngành hàng của thương hiệu đang chọn
  rồi gợi ý các chips từ khóa (bấm chip để chạy tìm ngay).
- Kết quả hiện lưới thumbnail — hover rồi bấm **➕** để đính kèm vào bài (video hiện
  thời lượng). Đính kèm bị chặn khi đã đủ số lượng hoặc trộn ảnh/video.
- Cần tìm nhiều trang / lưu vào thư viện? Bấm **🖼️ Chọn ảnh/video từ Pexels** để mở
  trình chọn đầy đủ (modal).

## Hẹn giờ đăng & tự động đăng bài

**Không cần mở terminal hay cài thêm gì.** Chỉ cần ứng dụng đang chạy, bài hẹn giờ sẽ
được đăng đúng giờ — vòng lặp tự động đăng chạy sẵn **bên trong chính web server**
(xem `src/instrumentation.ts`), kiểm tra bài đến hạn **mỗi 60 giây**.

### Bật / tắt ngay trên giao diện

Vào **Lịch đăng** hoặc **Cài đặt → Tự động đăng bài theo lịch**, có 2 nút:

| Nút | Việc nó làm |
|---|---|
| **⏸ Tắt tự động đăng** / **▶ Bật tự động đăng** | Bật/tắt hẳn việc tự đăng. Khi tắt, bài hẹn giờ **nằm chờ** và sẽ đăng ngay khi bạn bật lại (nếu đã quá giờ). Không mất bài, không mất lịch |
| **🔄 Chạy ngay** | Chạy một vòng ngay lập tức thay vì chờ nhịp kế tiếp — dùng để kiểm tra cấu hình |

Trạng thái hiển thị ở cả **Tổng quan**, **Lịch đăng** và **Cài đặt**:
🟢 đang chạy · ⚪ chờ nhịp đầu tiên · ⏸ đang tắt.

> Cờ bật/tắt này có hiệu lực với **mọi** nguồn — kể cả cron/worker bên ngoài.
> Bạn tắt là tắt thật, không có bài nào bị đăng ngoài ý muốn.

### Việc đăng bài không phụ thuộc trình duyệt

Vòng lặp chạy trong tiến trình server, **không** chạy trong tab trình duyệt — nên bạn
đóng trang, tắt máy tính khác, hay không mở app thì bài vẫn được đăng, miễn là server
còn chạy.

### Khi nào cần `npm run worker`?

**Bình thường không cần.** App đã tự lo. Chỉ dùng worker riêng khi:

- Bạn chạy **nhiều bản web server** và muốn tách việc đăng bài ra một tiến trình riêng.
- Môi trường triển khai **không giữ tiến trình server chạy liên tục**.

```bash
npm run worker        # tùy chọn — dừng bằng Ctrl+C
```

### Muốn tự quản hoàn toàn bằng cron?

Đặt `SCHEDULER_IN_PROCESS=0` trong `.env` để tắt vòng lặp trong app, rồi dùng cron hệ
điều hành gọi endpoint (nếu chạy nhiều bản server, thêm `?source=cron`):

```bash
# .env:  CRON_SECRET="..."   (tạo bằng: openssl rand -base64 32)
* * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

Nếu **chưa** đặt `CRON_SECRET`, endpoint chỉ nhận request từ máy cục bộ.
Đặt secret khi app được truy cập từ máy khác hoặc qua internet.

### Cách hẹn giờ

Trong trang Soạn bài: nhập nội dung, chọn Page, chọn ảnh/video, rồi ở khung
**⏰ Hoặc hẹn giờ để hệ thống tự đăng** chọn thời gian (có nút nhanh *+1 giờ*,
*20:00 hôm nay*, *08:00 mai*, *20:00 mai*) và bấm **⏰ Hẹn đăng**.
Bài chưa được gửi lên Facebook ở bước này — worker sẽ đăng khi tới giờ.

### Tự thử lại khi lỗi

Nếu lần đăng đầu thất bại (mạng lỗi, token tạm thời hỏng...), worker tự thử lại:
**lần 2 sau 5 phút**, **lần 3 sau 15 phút**. Hết 3 lần thì bài chuyển sang **Lỗi** và
dừng, kèm lý do cụ thể — bạn vào **Lịch sử đăng** bấm **🔁 Đăng lại** sau khi đã sửa.

Lỗi không thể sửa bằng cách thử lại (Page bị tắt, token hết hạn, file video bị mất)
được phát hiện ngay và **không** thử lại vô ích.

### Các cơ chế an toàn của worker

Tự động đăng bài là thao tác **không thể hoàn tác** (bài đã lên Facebook rồi thì không rút lại
âm thầm được), nên worker được thiết kế để thà không đăng còn hơn đăng trùng:

| Tình huống | Worker xử lý |
|---|---|
| Hai worker chạy cùng lúc | Mỗi lần giành bài là một `updateMany` **có điều kiện** (`status = SCHEDULED`) — SQLite thực thi nguyên tử nên chỉ một worker nhận `count = 1`. Đã kiểm chứng bằng test gọi **3 tick đồng thời** |
| Worker bị tắt đột ngột giữa lúc đăng | Bài nằm ở `PUBLISHING` quá 15 phút bị chuyển sang **Lỗi** kèm cảnh báo *"kiểm tra trên Facebook xem bài đã lên chưa rồi mới bấm Đăng lại"*. Worker **không** tự đăng lại vì không biết bài đã lên hay chưa |
| Page bị xóa khi bài đang chờ | Bài chuyển sang **Lỗi** kèm lý do rõ ràng — **không** kẹt im lặng ở trạng thái chờ |
| Page bị tắt / token hết hạn | Phát hiện **trước khi** gọi Facebook, chuyển thẳng sang **Lỗi** kèm hướng dẫn |
| Tick chạy chồng lên nhau | Nhịp mới bị bỏ qua nếu nhịp trước chưa xong (bài đăng lâu hơn chu kỳ) |

Mọi lần giành bài đều tăng `attempts`, nên số lần thử luôn đếm được và hiển thị trên Lịch đăng.

## Thương hiệu (trang `/brand`)

Đây là nơi **tạo và quản lý nhiều thương hiệu** trong workspace — mỗi thương hiệu
một bộ hồ sơ + trụ cột + kho tài liệu, **dùng chung cho mọi Page** gắn với nó.
Một Page nhiều thương hiệu? Không — một Page thuộc một thương hiệu; nhưng một
thương hiệu có thể có nhiều Page.

Tạo thương hiệu (➕ Thương hiệu mới), **Sửa** tên/mô tả, **Xoá** (Page được giữ
lại chỉ bỏ gán; bài đã đăng giữ nguyên), rồi mở **Hồ sơ & nội dung** để nhập
chi tiết. Gán Page vào thương hiệu ở [trang Pages](#quản-lý-page-trang-pages).

Ba khối nội dung, xếp theo mức độ quan trọng với AI:

**1. Thông tin cơ bản** — tên thương hiệu, ngành hàng, giới thiệu, sản phẩm/dịch vụ,
khách hàng mục tiêu, điểm khác biệt, khoảng giá, liên hệ, giọng điệu, hashtag,
câu kêu gọi hành động, bài viết mẫu.

> **Hai ô có tác dụng mạnh nhất:**
> - **Khoảng giá** — AI chỉ được nhắc giá trong khoảng này. **Để trống thì AI sẽ KHÔNG nói về giá**,
>   tránh việc bịa ra con số không có thật.
> - **Tuyệt đối không nhắc tới** — AI sẽ tránh hoàn toàn các chủ đề bạn liệt kê.

**2. Trụ cột nội dung** — quyết định "hôm nay đăng loại bài gì". Mỗi trụ cột có tên,
mô tả, mục tiêu và **tỉ trọng** (ví dụ: Giới thiệu sản phẩm 40%, Chia sẻ kiến thức 25%…).
Bấm **Tạo bộ 4 trụ cột mặc định** để có ngay bộ khởi đầu rồi sửa cho hợp ngành của mình.

Hệ thống xoay vòng theo tỉ trọng và **không bao giờ đăng 2 bài cùng loại liên tiếp**,
nhờ vậy Page không bị nhàm chán.

**3. Kho tài liệu** — dán bảng giá, câu hỏi thường gặp, chính sách bảo hành, câu chuyện
thương hiệu… AI **chỉ dùng số liệu có trong đây, không tự bịa**. Mỗi lần viết bài hệ thống
tự chọn tối đa 4 tài liệu liên quan nhất (chấm điểm theo độ trùng từ khóa + loại tài liệu)
để prompt không bị phình to.

## Chế độ tự động (trang `/autopilot`)

Mục tiêu: **quản lý nhiều cấu hình tự động cùng lúc** — mỗi Page một cấu hình,
bật/tắt riêng lẻ hoặc tất cả. Bảng tổng quan liệt kê mọi Page: trạng thái, chế
độ, nhịp đăng, số bài đã lên kế hoạch 7 ngày tới và lỗi gần nhất. Bấm
**Cấu hình** trên một dòng để chỉnh chi tiết cho Page đó.

Mỗi cấu hình trả lời 3 câu hỏi:

| Câu hỏi | Ô nhập | Mặc định |
|---|---|---|
| Mỗi ngày đăng mấy bài? | `postsPerDay` (1–10) | 2 |
| Đăng từ lúc nào đến lúc nào? | `windowStart` / `windowEnd` | 07:00 → 21:00 |
| Có tự tìm hình không? | `autoMedia` | Có |
| Dùng ảnh/video thế nào? | `mediaMix` | Chỉ ảnh |
| Nếu xen kẽ, bao nhiêu là video? | `videoPercent` | 25% |

Khi chọn **xen kẽ ảnh và video**, hệ thống chọn ngẫu nhiên theo tỉ lệ đã đặt nhưng vẫn giữ đúng hạn ngạch trong từng ngày. Một bài Facebook chỉ chứa ảnh hoặc một video, không trộn hai loại.

Ngoài ra chọn **những ngày nào trong tuần**, **đăng thẳng hay chờ duyệt** và số ảnh mỗi bài (tối đa 4).
Phần còn lại (khoảng cách tối thiểu giữa 2 bài, số ngày lên kế hoạch trước, độ dài,
giọng điệu, hashtag) nằm trong **Tùy chọn nâng cao** — có sẵn giá trị hợp lý.

### Hai chế độ

- **Chờ duyệt** (mặc định) — hệ thống viết sẵn, bạn xem rồi bấm duyệt mới đăng.
  An toàn, nên dùng trong vài ngày đầu để xem AI viết có hợp ý không.
- **Đăng thẳng** — hoàn toàn tự động. Bài vẫn hiện ở Lịch đăng **trước** giờ đăng
  nên bạn vẫn kịp sửa hoặc xóa.

### Hệ thống tự làm gì

Cứ 5 phút (đổi bằng `PLANNER_INTERVAL_MS`), bộ lập kế hoạch chạy cho từng Page đang bật:

1. Đếm xem mỗi ngày sắp tới đã đủ chỉ tiêu bài chưa — **chưa đủ mới tạo thêm**.
2. Chia khung giờ thành các đoạn đều nhau rồi **rải ngẫu nhiên trong từng đoạn**
   (giờ đăng mỗi ngày một khác, trông tự nhiên hơn đăng đúng giờ cố định),
   đồng thời tôn trọng khoảng cách tối thiểu.
3. Chọn trụ cột nội dung theo tỉ trọng, tránh lặp loại bài liên tiếp.
4. Gọi AI viết bài — kèm hồ sơ thương hiệu, tài liệu liên quan và **danh sách chủ đề
   vừa đăng gần đây để không viết trùng**.
5. Nếu bật tự tìm hình: hỏi AI từ khóa rồi tìm trên Pexels (mỗi từ khóa lấy 1 ảnh
   để bộ ảnh đa dạng).
6. Lưu bài ở trạng thái `SCHEDULED` (đăng thẳng) hoặc `PENDING_REVIEW` (chờ duyệt).

Việc **đăng bài vẫn do worker đảm nhiệm như cũ** — bộ lập kế hoạch không bao giờ gọi
Facebook. Nó cũng chạy kiểu "bắn rồi quên", nên nếu nhà cung cấp AI phản hồi chậm thì
**bài đang tới hạn vẫn được đăng đúng giờ**, không bị chờ.

### Các mức chặn an toàn

- Mặc định là **chờ duyệt**, không tự đăng gì cho tới khi bạn chủ động chuyển sang đăng thẳng.
- Không bật được nếu **thương hiệu của Page chưa có trụ cột nội dung nào** — hệ thống sẽ chỉ bạn qua trang Thương hiệu.
- Từ chối thông số vô lý: giờ kết thúc trước giờ bắt đầu, hoặc khung giờ quá hẹp so với
  số bài × khoảng cách tối thiểu. **Thông số cũ không bị ghi đè khi nhập sai.**
- Tối đa **12 bài mỗi lượt chạy**; gặp lỗi thì nghỉ 15 phút mới thử lại — giới hạn chi phí AI.
- Chỉ tạo bài cách hiện tại ít nhất 20 phút, tránh bài vừa tạo đã tới hạn đăng.
- Tìm ảnh thất bại **không làm mất bài** (vẫn đăng dạng chỉ có chữ) nhưng
  **hiện cảnh báo rõ ràng** trên trang, kèm gợi ý kiểm tra Pexels API Key.
- **Tắt chế độ tự động không xóa bài đã lên lịch** — chỉ ngừng tạo bài mới.

### Bài tự động trên Lịch đăng

Bài do hệ thống viết mang nhãn **🤖 kèm tên trụ cột** để phân biệt với bài bạn soạn tay.
Bài đang chờ duyệt hiện nhãn tím **Chờ duyệt** kèm lối tắt sang trang duyệt.

## Lịch đăng (Content Calendar)

Trang `/calendar` xem bài theo **tháng**:

- Lưới tháng (tuần bắt đầu Thứ Hai), mỗi ô hiện giờ + trích nội dung bài trong ngày.
- Bấm một ngày để mở danh sách bài của ngày đó và thao tác:
  **🕘 Đổi lịch**, **🚀 Đăng ngay** (không đợi tới giờ), **⏸ Hủy lịch** (về Nháp), **🗑️ Xóa**.
- Thanh trạng thái trên cùng: worker còn sống không, số bài đang chờ, số bài chờ thử lại,
  và bài hẹn gần nhất.

## Đăng video từ máy của bạn

Trong trang Soạn bài, bấm **⏫ Tải video từ máy** để chọn file video từ máy tính.
Thanh tiến trình hiện % đã tải lên; xong thì video nằm trong khay đính kèm kèm dung lượng.

- Định dạng nhận: **MP4, MOV, WEBM, AVI, MKV** — tối đa **200MB**/video (đổi bằng `MAX_VIDEO_BYTES`).
- Không trộn được ảnh với video (quy định của Facebook) — bỏ ảnh trước nếu đang có.
- Bấm **×** để bỏ video khỏi khay: file trên máy chủ cũng bị xóa theo.
- Khi đăng, app gửi file lên Graph API bằng `multipart/form-data` (trường `source`),
  dùng `fs.openAsBlob` để **stream từ đĩa** — video vài trăm MB vẫn đăng được mà không tốn RAM.

File lưu trong `uploads/<userId>/` với tên do app sinh (không dùng tên gốc của bạn).
Mọi request đọc file đều kiểm tra đăng nhập và chỉ đọc được file của chính mình.
File tải lên nhưng không dùng sẽ được **tự động dọn sau 24 giờ**.

## Lịch sử đăng bài (trang Lịch sử đăng)

Vào `/history` để xem toàn bộ bài đã đăng, đang đăng và bài lỗi:

- **Lọc theo trạng thái**: Tất cả / Đã đăng / Lỗi / Đang đăng — kèm số lượng mỗi loại.
- **Tìm theo nội dung** bài đăng (giữ nguyên bộ lọc trạng thái khi tìm).
- **Phân trang** 20 bài/trang, mới nhất trước.
- Bài **Đã đăng**: có link 🔗 mở thẳng bài trên Facebook.
- Bài **Lỗi**: hiện rõ **lý do lỗi** từ Facebook (bấm "Xem chi tiết" nếu dài),
  kèm nút **🔁 Đăng lại** — dùng lại đúng nội dung và media đã lưu, không cần soạn lại.
- Nút **🗑️ Xóa** xóa bài khỏi lịch sử (xóa cả file video upload kèm theo).

## Tìm ảnh/video từ Pexels (trang Thư viện Media + trong Soạn bài)

Vào `/media` (hoặc bấm **🖼️ Chọn ảnh/video từ Pexels** trong trang Soạn bài):

1. Nhập từ khóa rồi bấm **🔍 Tìm** — để trống và bấm Tìm sẽ xem ảnh/video phổ biến.
   Từ khóa **tiếng Anh** cho kết quả tốt nhất.
2. Chuyển tab **🖼️ Ảnh** / **🎬 Video**, xem preview, phân trang bằng **Trang sau →**.
3. Bấm **✨ AI gợi ý từ khóa** — AI đọc nội dung bài đang soạn và đề xuất từ khóa
   (hiển thị nhãn tiếng Việt + query tiếng Anh). Bấm một gợi ý để tìm ngay.
4. Chọn media rồi **Thêm N mục vào bài** (trong Soạn bài) hoặc **Lưu N mục vào thư viện** (ở `/media`).

Ràng buộc của Facebook được chặn ngay khi chọn: **tối đa 4 ảnh**, **tối đa 1 video**,
**không trộn ảnh với video**. Khi bấm Đăng, server kiểm tra lại lần nữa.

Ảnh/video đã chọn hiện trong khay đính kèm của trình soạn thảo, có thể bấm **×** để bỏ.
Lưu nháp sẽ giữ nguyên media — mở lại nháp bằng nút **Sửa** là có đủ nội dung + ảnh.

**Thư viện của tôi** (tab thứ hai ở `/media`): ảnh/video đã lưu để tái sử dụng, kèm tên tác giả,
liên kết trang nguồn, nút **Chép URL** và **Xóa**. Media đã có trong thư viện được gắn nhãn
"Đã lưu" khi tìm kiếm, và không bị lưu trùng.

### Cơ chế tiết kiệm quota

Pexels cho **200 request/giờ**. App tự:
- **Cache kết quả tìm kiếm 10 phút** (theo từ khóa + loại + trang) — tìm lại không tốn quota,
  hiển thị nhãn "từ cache".
- Chỉ gọi Pexels khi bạn bấm Tìm, không tự gọi khi mở picker.
- Hiển thị **số request đã dùng/200 trong 1 giờ** ở đầu trang `/media`.

Khi chọn video, app ưu tiên bản **MP4 ~HD (≤1920px)** thay vì bản 4K để file nhẹ, đăng nhanh hơn.

## Kết nối Facebook & đăng bài

1. Vào `/facebook-apps` → thêm **Facebook App** (tên gợi nhớ + App ID + App
   Secret + Graph version). Một workspace thêm được **nhiều App** — mỗi App lấy
   được một nhóm Page khác nhau (giới hạn của Facebook).
2. Ở khối App tương ứng (hoặc trang `/pages`) dán **User Access Token** của
   đúng App đó (lấy từ [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
   với quyền `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`)
   → bấm **Đồng bộ Pages**. App tự đổi sang token long-lived (~60 ngày), lưu
   Page token vào DB kèm `connectionId` của App đã đồng bộ.
3. Vào `/composer` → chọn Page (thấy tên Page + thương hiệu), nhập nội dung
   (hoặc để AI viết), hashtag, chọn ảnh/video từ Pexels → **Đăng ngay**.

Dữ liệu cũ (cấu hình Facebook trong trang Cài đặt) được **migration tự động
chuyển** thành một Connection mặc định trong workspace đầu tiên — token và
App Secret mã hóa được copy nguyên vẹn, không phải nhập lại.

Bài đăng được ghi vào DB với trạng thái `PUBLISHED` / `FAILED` kèm thông báo lỗi thật từ Graph API,
hiển thị ở cột "Lịch sử gần đây".

> Graph API yêu cầu **POST** cho mọi thao tác ghi (đăng bài, upload ảnh). `fbFetch` trong
> `src/lib/facebook.ts` hỗ trợ cả GET và POST — đặt `FB_GRAPH_BASE_URL` để trỏ về server giả khi test.

> ⚠️ Page token lấy từ user token long-lived có hiệu lực ~60 ngày. Trang `/pages` hiển thị số ngày còn lại
> và cảnh báo khi sắp hết hạn — chỉ cần dán token mới và đồng bộ lại.

## Lưu ý bảo mật

- API key lưu trong DB đã mã hóa AES-256-GCM; `SESSION_SECRET` trong `.env` (đã gitignore) là khóa gốc — **đừng đổi sau khi đã lưu key**, nếu không phải nhập lại toàn bộ.
- Session là JWT HS256, cookie `httpOnly` + `sameSite=lax`.
- Mỗi trang private và mọi Server Action đều gọi `requireCurrentUser()` — `proxy.ts` chỉ là lớp chặn optimistic.
- Key không bao giờ được gửi xuống client: UI chỉ nhận giá trị đã mask.

## Script dev & test (tùy chọn)

```bash
node scripts/smoke-login.mjs      # tạo user test (smoke@test.local / test123) + in session cookie
npm run mock:ai                   # mock provider OpenAI-compatible ở http://127.0.0.1:4010/v1
                                  #   Base URL: http://127.0.0.1:4010/v1 · API Key: test-key-abc123
npm run mock:fb                   # mock Facebook Graph API ở http://127.0.0.1:4020
npm run mock:pexels               # mock Pexels API ở http://127.0.0.1:4030 (key: pexels-test-key)
npm run test:e2e                  # E2E cấu hình AI + tải model (cần dev server + mock:ai)
npm run test:e2e:composer         # E2E Tuần 3: AI viết → chọn phương án → lưu nháp → đăng bài
npm run test:e2e:media            # E2E Tuần 4: tìm media, thư viện, gợi ý từ khóa, đăng ảnh/video
npm run test:e2e:week5            # E2E Tuần 5: upload video, lịch sử, lỗi + đăng lại
npm run test:e2e:week6            # E2E Tuần 6: hẹn giờ, worker tự đăng, retry, calendar
npm run test:e2e:scheduler        # E2E: vòng lặp tự đăng trong app + nút bật/tắt trên web
npm run test:e2e:autopilot        # E2E: hồ sơ thương hiệu + chế độ tự động (70 kiểm tra)
npm run test:e2e:autopilot:cycle  # E2E: vòng đời trọn vẹn — AI viết → tìm ảnh → tự đăng lên FB
npm run test:plan                 # Test logic thuần: chia khung giờ + xoay vòng trụ cột (55 kiểm tra)
npm run test:multi-workspace     # Test đa workspace + đa Facebook App (25 kiểm tra)
npm run test:db:prepare           # Tạo/cập nhật schema DB test (test.db)
node scripts/restore-from-facebook.mjs   # Khôi phục Page + token từ Facebook (khi sự cố)
npm run dev:test                  # Web server trỏ vào test.db + mock (dùng khi chạy test)
npm run db:backup                 # Sao lưu dev.db vào backups/
npm run worker                    # (tùy chọn) worker riêng — app đã tự chạy sẵn
```

Để chạy `test:e2e:composer` và `test:e2e:media`, dev server phải trỏ về mock
(bài test không đi lên Facebook/Pexels thật):

```bash
FB_GRAPH_BASE_URL=http://127.0.0.1:4020 PEXELS_BASE_URL=http://127.0.0.1:4030 npm run dev
```

> Nếu cổng 4020 đang bị chiếm bởi một mock cũ, chạy mock ở cổng khác và trỏ dev server theo:
> `PORT=4021 npm run mock:fb` rồi `FB_GRAPH_BASE_URL=http://127.0.0.1:4021 npm run dev`.

> Test dùng Playwright với Chrome có sẵn trên máy (`channel: "chrome"`), không tải browser riêng.
> Mock FB **từ chối GET** trên `/feed`, `/photos`, `/videos` giống Graph API thật — nhờ vậy test
> phát hiện được lỗi nếu code lỡ dùng sai HTTP method.
> Mock Pexels trả về file video giả cả bản 4K lẫn HD để test kiểm chứng app chọn đúng bản HD.
> Mock FB **phân tích được `multipart/form-data`** nên kiểm chứng được rằng video upload
> thật sự gửi kèm file (tên file + content-type + số byte), không chỉ gửi tên file.

> `test:e2e:week6` tự đọc `CRON_SECRET` từ môi trường. Nếu dev server có đặt secret,
> chạy test kèm secret tương ứng: `CRON_SECRET="..." npm run test:e2e:week6`.
> Nếu không đặt, test kiểm tra nhánh cho phép loopback.

## An toàn dữ liệu (đọc trước khi chạy test)

Ứng dụng dùng **2 database tách biệt**:

| DB | Dùng cho | File |
|---|---|---|
| **Thật** | Ứng dụng bạn dùng hằng ngày | `dev.db` |
| **Test** | Mọi script kiểm thử | `test.db` |

Script test **không bao giờ** mở `dev.db`. Có 3 lớp chặn:

1. Mặc định của test là `./test.db`, không phải `./dev.db`.
2. Trỏ `TEST_DB` vào `dev.db` → script **từ chối chạy** ngay.
3. Kể cả file DB có chứa user thật (không phải `smoke@test.local`) → **từ chối chạy**.

Nhờ vậy một lần gõ nhầm lệnh cũng không thể xoá dữ liệu thật. Bài học này có thật:
một lần dọn dữ liệu test chạy nhầm trên `dev.db` đã xoá mất Page thật của người dùng.

### Chạy test đúng cách

```bash
npm run test:db:prepare     # tạo/cập nhật schema cho test.db (1 lần, hoặc sau khi đổi schema)
npm run db:backup           # sao lưu dev.db vào backups/ (nên chạy trước)

# terminal 1-3: mock server
npm run mock:ai
PORT=4021 npm run mock:fb
npm run mock:pexels

# terminal 4: web server trỏ vào DB TEST
npm run dev:test

# terminal 5
node scripts/smoke-login.mjs          # tạo user test trong test.db
npm run test:e2e:week6                # chạy test
```

`npm run db:backup` giữ 10 bản gần nhất trong `backups/` (đã có trong `.gitignore`).
Chạy nó trước mỗi lần migration hoặc dọn dữ liệu.

