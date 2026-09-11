# Kế hoạch dự án: Web App Tự động viết nội dung & đăng bài Facebook bằng AI

> Mục tiêu tổng quát: xây dựng một web app giúp **tự động sinh nội dung bằng AI, tìm hình/video từ Pexels, và đăng trực tiếp lên Facebook Page** (đăng ngay hoặc lên lịch), nhằm tối ưu hóa thời gian làm marketing.

---

## 1. Mục tiêu & phạm vi

| Vấn đề hiện tại | Giải pháp trong app |
|---|---|
| Viết caption/hashtag thủ công, mất thời gian | AI sinh bài đăng theo chủ đề, giọng điệu, độ dài, ngôn ngữ |
| Tìm ảnh/video phù hợp tốn công | Tìm kiếm & chọn media từ Pexels API ngay trong app |
| Đăng bài thủ công nhiều Page | Đăng 1 nút bấm / tự động theo lịch |
| Không có chỗ quản lý nội dung tập trung | Content calendar + lịch sử đăng + thống kê |

**Phạm vi MVP:** 1 người dùng (bạn), quản lý các Page Facebook của bạn.
**Mở rộng sau:** đa người dùng (SaaS), nhiều mạng xã hội (Zalo, TikTok...).

---

## 2. Tính năng chi tiết

### Giai đoạn MVP
1. **Đăng nhập & Dashboard** — khung app, tổng quan bài đã đăng/sắp đăng.
2. **Kết nối Facebook Page** — OAuth Facebook, lưu Page Access Token (long-lived), chọn Page cần quản lý.
3. **AI viết nội dung**
   - Nhập: chủ đề / từ khóa / link tham khảo, chọn giọng điệu (vui nhộn, chuyên nghiệp, bán hàng...), độ dài, ngôn ngữ (Tiếng Việt mặc định).
   - AI sinh: caption + hashtag + CTA, có thể tạo 2–3 phương án để chọn.
   - Chỉnh sửa trực tiếp trước khi đăng.
4. **Media từ Pexels**
   - Tìm ảnh theo từ khóa → grid preview → chọn 1–n ảnh đính kèm.
   - Tìm video theo từ khóa → xem trước → chọn video (hoặc tải file về).
   - Nút "AI gợi ý từ khóa tìm ảnh" dựa trên nội dung bài viết.
5. **Soạn & đăng bài**
   - Composer: text + ảnh/video + chọn Page → đăng ngay qua Graph API.
   - Xem trước giao diện bài đăng kiểu Facebook.
6. **Lịch sử bài đăng** — trạng thái (nháp / đã lên lịch / đã đăng / lỗi), nội dung, page, thời gian.

### Giai đoạn nâng cao
7. **Lên lịch đăng tự động** — chọn thời điểm, worker tự đăng (queue + cron), retry khi lỗi.
8. **Content calendar** — xem theo tuần/tháng, kéo-thả đổi lịch.
9. **Template & gợi ý ý tưởng** — mẫu bài theo ngành hàng, AI gợi ý kế hoạch nội dung tuần.
10. **Thống kê tương tác** — likes/comments/shares/reach từ Graph API Insights.
11. **Đăng nhiều Page** — biến thể nội dung nhẹ cho từng Page.
12. **Nguồn media mở rộng** — Unsplash, Pixabay, upload ảnh/video của riêng bạn.

---

## 3. Tech stack đề xuất

| Thành phần | Công nghệ | Lý do |
|---|---|---|
| Frontend + Backend | **Next.js 14+ (App Router)** | 1 codebase, API routes làm backend, deploy dễ |
| Database | **SQLite + Prisma** khi dev/demo → chuyển PostgreSQL khi deploy | Chạy ngay, không cần cài server DB |
| Hàng đợi & lịch | **BullMQ + Redis** | Đăng bài địnhczas, retry an toàn |
| AI | **OpenAI-compatible API cấu hình được** (BASE_URL + API_KEY + MODEL qua env) | Dùng được bất kỳ nhà cung cấp thứ 3 nào tương thích OpenAI |
| Media | **Pexels API** (ảnh + video) | Miễn phí, chất lượng cao |
| Facebook | **Facebook Graph API (Pages)** | Đăng text/ảnh/video chính thức |
| Auth | **NextAuth.js** | Đăng nhập nhanh |
| Deploy | VPS + Docker, hoặc Vercel + Supabase/Neon | Tùy ngân sách |

---

## 4. Kiến trúc tổng quan

```
┌─────────────────────────── Next.js Web App ───────────────────────────┐
│  UI: Dashboard · Composer · Media Picker · Calendar · Settings        │
└──────────────┬────────────────────────────────────────────────────────┘
               │ API Routes
   ┌───────────┼───────────────┬─────────────────┬──────────────────┐
   ▼           ▼               ▼                 ▼                  ▼
AI Service  Media Service   FB Service       Post Store        Scheduler
(OpenAI)    (Pexels)        (Graph API)      (PostgreSQL)      (BullMQ+Redis)
                                                               │
                                                        Worker đăng bài theo lịch
                                                               ▼
                                                        Facebook Graph API
```

**Luồng chính:**
1. User nhập chủ đề → AI Service trả caption + từ khóa gợi ý.
2. Media Service tìm ảnh/video Pexels theo từ khóa → user chọn.
3. User bấm "Đăng ngay" hoặc "Đặt lịch" → lưu vào DB (+ queue nếu lịch).
4. FB Service gọi Graph API `/{page-id}/photos | /videos | /feed`.
5. Lưu kết quả & lỗi vào lịch sử, hiển thị trên dashboard.

---

## 5. Điều kiện cần bên ngoài (quan trọng)

### Facebook (✅ đã có sẵn app/token)
1. Dùng App ID/Secret + Page Access Token sẵn có — cấu hình qua `.env`.
2. Quyền cần có trên token: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
3. Lưu ý Page Access Token hết hạn (60 ngày nếu là token ngắn hạn) — app sẽ có màn hình kiểm tra/cập nhật token.

### API keys cần chuẩn bị
- `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` — nhà cung cấp AI thứ 3 tương thích OpenAI (bạn đã có URL + key + model).
- `PEXELS_API_KEY` — đăng ký miễn phí tại pexels.com/api.
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_PAGE_TOKEN` — dùng app/token sẵn có.

---

## 6. Lộ trình triển khai (ước tính ~6 tuần part-time)

| Tuần | Công việc | Kết quả |
|---|---|---|
| 1 | Khởi tạo Next.js + DB schema (User, Page, Post, Media, Schedule) + Auth + dashboard khung | ✅ **Hoàn thành** — App chạy được, đăng nhập xong |
| 2 | Kết nối Facebook: lưu token, list Pages, **đăng bài text + ảnh test thành công** + trang Cài đặt cấu hình AI/Pexels/Facebook trên web | ✅ **Hoàn thành** — Đồng bộ Pages + pipeline đăng bài đã chạy |
| 3 | Module AI viết nội dung: prompt template, tùy chọn giọng điệu/độ dài, 2–3 phương án, chỉnh sửa | ✅ **Hoàn thành** — Sinh 3 phương án, chọn/sửa/lưu nháp/đăng |
| 4 | Tích hợp Pexels: tìm ảnh + video, preview, chọn đính kèm, gợi ý từ khóa bằng AI | ✅ **Hoàn thành** — Picker + thư viện + gợi ý từ khóa AI + đăng ảnh/video |
| 5 | Đăng video (upload file qua Graph API), lịch sử bài đăng, xử lý lỗi + retry | ✅ **Hoàn thành** — Upload video multipart + trang Lịch sử + đăng lại bài lỗi |
| 6 | Lên lịch tự động, content calendar, polish UI | ✅ **Hoàn thành** — Hẹn giờ + worker tự đăng + retry + lịch tháng |

---

## 7. Chi phí ước tính / tháng

| Hạng mục | Chi phí |
|---|---|
| Pexels API | Miễn phí (200 req/giờ) |
| Facebook Graph API | Miễn phí |
| AI (provider thứ 3, ~150 bài/tháng) | Tùy gói bạn đăng ký, thường 0–10 USD |
| Hosting Vercel free + Neon free | 0 USD (hoặc VPS ~5 USD) |
| Redis (Upstash free tier) | 0 USD |
| **Tổng** | **~0–15 USD/tháng** |

---

## 8. Rủi ro & lưu ý

- **App Review của Meta** — chỉ ảnh hưởng nếu cho người ngoài dùng; cá nhân dùng chế độ Dev là đủ.
- **Token Facebook hết hạn** (60 ngày) — cần cơ chế gia hạn/refresh tự động + cảnh báo.
- **Rate limit Pexels** (200 req/giờ) — cache kết quả tìm kiếm trong DB.
- **Chính sách nội dung Facebook** — bài đăng vi phạm có thể bị từ chối/ẩn; cần màn hình xem trước + cảnh báo.
- **Video lớn** — Graph API có giới hạn dung lượng; cần upload resumable nếu file > vài trăm MB.
- **API key bảo mật** — giữ toàn bộ key phía server (API routes), không bao giờ đưa xuống trình duyệt.

---

## 10. Quyết định đã chốt với bạn

- ✅ Phạm vi MVP: **đầy đủ** (AI + Pexels + đăng ngay/lên lịch).
- ✅ AI: dùng **URL + API key + model của nhà cung cấp thứ 3** theo cấu hình (chuẩn OpenAI-compatible).
- ✅ Database: **SQLite** (Prisma) khi phát triển.
- ✅ Facebook: **đã có sẵn app/token** → test đăng bài thật ngay Tuần 2.
- ✅ Cấu hình tích hợp **qua UI web** (trang Cài đặt), key mã hóa AES-256-GCM trong DB — không cần sửa `.env`.

---

## 11. Thay đổi so với kế hoạch ban đầu

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| Next.js 14 | **Next.js 16.3.4** | `create-next-app` cài bản mới nhất; dùng `proxy.ts` thay `middleware.ts`, `cookies()` async |
| Prisma + PostgreSQL | **Prisma 7 + SQLite + driver adapter** `better-sqlite3` | Prisma 7 bắt buộc driver adapter cho SQL; SQLite chạy ngay không cần server |
| NextAuth.js | **JWT session tự viết (jose)** | Đúng pattern guide chính thức của Next 16, ít phụ thuộc, phù hợp app 1 người dùng |
| Model `Schedule` riêng | **Tích hợp vào `Post`** (`scheduledAt` + `status`) | Đơn giản hơn, tránh bảng dư thừa; tách ra sau nếu cần lịch lặp |
| Facebook OAuth | **User Access Token + tự đổi long-lived** | Không cần redirect URI công khai khi chạy localhost; phù hợp app cá nhân |
| AI: nhập cả Model thủ công | **Chỉ nhập Base URL + API Key, model tự tải từ `/models`** | Bớt thao tác và tránh gõ sai tên model; vẫn cho gõ tay nếu provider không hỗ trợ `/models` |
| Graph API: mọi thao tác dùng chung hàm GET | **`fbFetch` hỗ trợ cả GET và POST** | Phát hiện khi test E2E: đăng bài là thao tác ghi, Graph API **bắt buộc POST** — trước đó gọi GET nên bài không được đăng |
| `Media` chỉ gắn cứng vào `Post` | **`postId` nullable + `userId` + metadata Pexels** | Cần thư viện ảnh dùng lại được; lưu `providerId`/tác giả/trang nguồn để ghi công và chống trùng |
| Đính kèm ảnh bằng textarea URL | **Media Picker + hidden JSON input** | Người dùng không phải copy URL thủ công; vẫn hỗ trợ URL ngoài qua `source: "URL"` |
| Upload video qua Server Action | **Route Handler riêng (`/api/uploads`)** | Server Action giới hạn body 1MB; video cần stream file lớn nên phải dùng Route Handler |
| Đăng video chỉ bằng URL công khai | **Hỗ trợ cả `file_url` và upload `source`** | Người dùng có video riêng trên máy, không có URL công khai — dùng multipart với `fs.openAsBlob` để không nạp cả file vào RAM |
| Hàng đợi **BullMQ + Redis** cho lịch đăng | **Hàng đợi ngay trong bảng `Post` (SQLite)** | Máy không có Redis và app tự host một người dùng. Bắt cài Redis chỉ để hẹn giờ là quá nặng, dễ hỏng khi triển khai. SQLite đã là nguồn dữ liệu duy nhất — bài đến hạn = `status=SCHEDULED` và `scheduledAt <= now`. Chống đăng trùng bằng `updateMany` CÓ ĐIỀU KIỆN (nguyên tử trong SQLite), đã kiểm chứng bằng test gọi 3 tick đồng thời |
| Phải mở terminal chạy `npm run worker` mới đăng được bài hẹn giờ | **Vòng lặp tự động đăng chạy ngay trong tiến trình web server** (khởi động từ `src/instrumentation.ts`). Không cần terminal, không cài thêm gì — chỉ cần app đang chạy. Người dùng **bật/tắt và bấm *Chạy ngay* trên giao diện** (Lịch đăng + Cài đặt); cờ lưu trong DB nên **có hiệu lực với cả cron/worker bên ngoài**. Vẫn giữ `/api/cron/tick` và cờ `SCHEDULER_IN_PROCESS=0` cho ai muốn tự quản bằng cron |
| Test E2E chạy trực tiếp trên `dev.db` | **Tách hẳn DB test (`test.db`) khỏi DB thật (`dev.db`)** + 3 lớp chặn: mặc định là `test.db`, từ chối nếu `TEST_DB` trỏ vào `dev.db`, từ chối nếu file DB chứa user thật. Thêm `npm run db:backup` (giữ 10 bản) và `npm run test:db:prepare`. Lý do: một lần dọn dữ liệu test chạy nhầm trên `dev.db` đã xoá mất Page thật — kiểm chứng bằng md5: 185 test chạy xong `dev.db` giống hệt từng byte |
| AI viết bài chỉ dựa trên chủ đề người dùng gõ | **Hồ sơ thương hiệu riêng cho từng Page** (`BrandProfile` + `ContentPillar` + `KnowledgeDoc`) nạp vào prompt mỗi lần viết | Gõ lại bối cảnh doanh nghiệp cho từng bài là việc lặp vô ích, và AI hay bịa số liệu. Nay AI có "nguồn sự thật duy nhất": khoảng giá để trống thì AI **không được nói về giá**, tài liệu bảng giá/FAQ được chọn tối đa 4 mục liên quan nhất để prompt không phình to |
| Người dùng phải tự soạn từng bài | **Chế độ tự động**: đặt số bài/ngày + khung giờ + có tự tìm ảnh không, hệ thống tự lên lịch, viết, tìm ảnh, đăng liên tục | Đúng mục tiêu ban đầu "tối ưu hoá thời gian làm việc". Giờ đăng **rải ngẫu nhiên trong từng đoạn của khung giờ** (không đăng đúng giờ cố định trông như máy), trụ cột nội dung **xoay vòng theo tỉ trọng và không lặp liên tiếp**, prompt kèm **danh sách chủ đề vừa đăng để không viết trùng** |
| Bộ lập kế hoạch chạy chung luồng với worker đăng bài | **Chạy kiểu "bắn rồi quên", gọi TRƯỚC `runSchedulerTick` và không `await`** | Gọi AI mất vài giây tới vài chục giây cho mỗi bài. Nếu chờ, bài đang tới hạn sẽ bị đăng trễ. Bộ lập kế hoạch cũng **không bao giờ gọi Facebook** — mọi việc đăng vẫn nằm trong `scheduler.ts`, giữ một đường đăng bài duy nhất |
| Lỗi tìm ảnh thì bỏ qua im lặng | **Vẫn tạo bài (dạng chỉ có chữ) nhưng hiện cảnh báo vàng kèm gợi ý kiểm tra Pexels API Key** | Phát hiện khi chạy E2E: seed sai key làm 0/6 bài có ảnh mà giao diện **không báo gì** — người dùng tưởng đang có ảnh trong khi bài đăng lên trắng trơn. Mất bài còn tệ hơn nên không chặn, nhưng im lặng thì không chấp nhận được |
| Ghi trực tiếp từ worker vào DB | **Worker gọi `POST /api/cron/tick`** | Logic đăng bài chỉ tồn tại ở một nơi (`lib/scheduler.ts`) và dùng chung với web app, không bị lệch. Đổi lại worker cần web server đang chạy — vốn luôn đúng vì app phải chạy để dùng |

---

## 9. Trạng thái hiện tại

MVP 6 tuần đã hoàn thành, cộng thêm phần mở rộng **Hồ sơ thương hiệu + Chế độ tự động**.

### Đã có

| Phần | Trang | Trạng thái |
|---|---|---|
| Đăng nhập, cấu hình tích hợp | `/login`, `/settings` | ✅ |
| Kết nối Facebook Page | `/pages` | ✅ |
| AI viết nội dung + chọn phương án | `/composer` | ✅ |
| Thư viện ảnh/video Pexels + upload video | `/media` | ✅ |
| Hẹn giờ + tự động đăng (bật/tắt trên web) | `/calendar` | ✅ |
| Lịch sử đăng + đăng lại khi lỗi | `/history` | ✅ |
| **Hồ sơ thương hiệu + trụ cột + kho tài liệu** | `/brand` | ✅ |
| **Chế độ tự động (đặt thông số rồi thôi)** | `/autopilot` | ✅ |

### Độ phủ test

| Bộ test | Số kiểm tra |
|---|---|
| `test:plan` — logic chia giờ + xoay vòng trụ cột (thuần, không cần server) | 55 |
| `test:e2e:autopilot` — hồ sơ thương hiệu + chế độ tự động | 70 |
| `test:e2e:autopilot:cycle` — vòng đời trọn vẹn tới khi bài lên Facebook | 15 |
| `test:e2e` + `composer` + `media` + `week5` + `week6` + `scheduler` | 185+ |

### Hướng mở rộng tiếp

1. **Báo cáo hiệu quả** — kéo lượt tương tác từ Graph API về, biết trụ cột nào ăn khách
   để tự điều chỉnh tỉ trọng.
2. **Học từ bài đạt kết quả tốt** — đưa bài tương tác cao vào phần "bài viết mẫu" tự động.
3. **Giờ vàng theo dữ liệu thật** — thay vì rải ngẫu nhiên, ưu tiên khung giờ mà Page
   thực sự có nhiều tương tác.
4. **Nhiều Page cùng lúc** — cấu trúc dữ liệu đã sẵn sàng (mỗi Page một hồ sơ + một cấu hình
   tự động riêng), chỉ cần thêm màn hình tổng quan nhiều Page.
