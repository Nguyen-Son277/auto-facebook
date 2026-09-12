# Kế hoạch nâng cấp: Đa Workspace, đa thương hiệu và đa Facebook Graph API

## 1. Tầm nhìn sản phẩm

Nâng cấp ứng dụng hiện tại thành nền tảng quản lý nội dung Facebook theo cấu trúc:

**User → Workspace → Facebook Connection → Facebook Page → Brand → Content → Post/Schedule**

Một tài khoản người dùng có thể:

- Tạo và chuyển đổi giữa nhiều workspace.
- Quản lý nhiều thương hiệu trong mỗi workspace.
- Cài đặt một hoặc nhiều Facebook Graph API App trong từng workspace.
- Đồng bộ nhiều Facebook Page từ những Facebook App khác nhau.
- Gán một hoặc nhiều Page vào từng thương hiệu.
- Soạn nội dung, duyệt, lên lịch và đăng tự động trên nhiều Page.
- Theo dõi token, quota, lỗi và trạng thái đăng theo từng Facebook Connection.

Workspace là ranh giới cách ly dữ liệu, quyền truy cập và cấu hình tích hợp. Cấu hình Facebook không còn được lưu chung trong `AppSetting` toàn hệ thống.

## 2. Kiến trúc nghiệp vụ mục tiêu

### 2.1 Workspace là tenant chính

Mọi dữ liệu nghiệp vụ phải thuộc về một workspace, trực tiếp hoặc thông qua quan hệ cha:

- Facebook Connection
- Facebook Page
- Brand và Brand Profile
- Content Pillar
- Knowledge Document
- Media
- Post
- AutoPilot
- Used Media
- Lịch đăng và lịch sử đăng

Tất cả truy vấn và Server Action phải kiểm tra membership rồi giới hạn dữ liệu theo `workspaceId`. Không được tin tưởng `workspaceId` hoặc ID tài nguyên do client gửi lên nếu chưa xác minh quyền truy cập.

### 2.2 Tách Facebook App khỏi Facebook Page

Cần có hai lớp dữ liệu riêng:

1. `FacebookConnection`: đại diện cho một bộ cấu hình Facebook Graph API trong workspace, bao gồm App ID, App Secret, token và trạng thái kết nối.
2. `FacebookPage`: Page được đồng bộ qua một `FacebookConnection` cụ thể.

Một workspace có nhiều Facebook Connection. Một connection có thể cung cấp nhiều Page. Khi đồng bộ hoặc đăng bài, mỗi Page luôn sử dụng connection đang liên kết với Page đó.

### 2.3 Tách Brand khỏi Workspace

Một workspace có thể quản lý nhiều thương hiệu. Một thương hiệu có thể có nhiều Facebook Page.

Hồ sơ thương hiệu, giọng điệu, tài liệu và trụ cột nội dung được dùng chung giữa các Page thuộc cùng thương hiệu. Cấu hình AutoPilot vẫn có thể tùy chỉnh riêng cho từng Page.

## 3. Mô hình dữ liệu đề xuất

### 3.1 Workspace và thành viên

Thêm các model:

#### `Workspace`

- `id`
- `name`
- `slug`
- `timezone`
- `status`
- `ownerId`
- `createdAt`
- `updatedAt`

#### `WorkspaceMember`

- `workspaceId`
- `userId`
- `role`
- Unique `(workspaceId, userId)`

Các role dự kiến:

- `OWNER`
- `ADMIN`
- `EDITOR`
- `VIEWER`

Không thêm trực tiếp một `workspaceId` cố định vào `User`, vì một User cần có khả năng tham gia nhiều workspace.

### 3.2 Facebook Connection

Thêm model `FacebookConnection`:

- `id`
- `workspaceId`
- `name`
- `appId`
- `appSecretEncrypted`
- `userAccessTokenEncrypted`
- `graphApiVersion`
- `status`: `ACTIVE`, `EXPIRED`, `ERROR`, `DISABLED`
- `tokenExpiresAt`
- `lastValidatedAt`
- `lastSyncedAt`
- `lastError`
- `createdById`
- `createdAt`
- `updatedAt`

Ràng buộc và index:

- Unique `(workspaceId, appId)`
- Index `(workspaceId, status)`

Không trả App Secret hoặc access token đầy đủ về giao diện sau khi lưu.

### 3.3 Facebook Page

Nâng cấp `FacebookPage`:

- Thêm `workspaceId`.
- Thêm `connectionId`.
- Thêm `brandId`, cho phép nullable trong giai đoạn migration.
- Giữ `fbPageId`, tên, ảnh đại diện và Page Access Token đã mã hóa.
- Thêm `syncStatus`, `tokenExpiresAt`, `lastSyncedAt`, `lastError`.
- Unique `(workspaceId, fbPageId)`.
- Index `connectionId`.
- Index `(workspaceId, brandId)`.

Nếu một Page được phát hiện qua hai Facebook App trong cùng workspace, không tạo bản ghi trùng. Hệ thống phải hiển thị connection hiện tại và cung cấp quy trình chuyển connection an toàn.

### 3.4 Brand

Thêm model `Brand`:

- `id`
- `workspaceId`
- `name`
- `slug`
- `status`
- `description`
- `logoUrl`
- `primaryColor`
- `createdAt`
- `updatedAt`

Điều chỉnh các quan hệ:

- `BrandProfile` thuộc `Brand`.
- `ContentPillar` thuộc `Brand`.
- `KnowledgeDoc` thuộc `Brand`.
- `FacebookPage` có thể thuộc `Brand`.
- `Post` lưu thêm `brandId` để hỗ trợ lọc và báo cáo.

Thiết kế này cho phép một thương hiệu dùng chung hồ sơ nội dung trên nhiều Page mà không cần sao chép dữ liệu.

### 3.5 Settings

Thay `AppSetting` toàn cục bằng hai phạm vi:

- `SystemSetting`: cấu hình triển khai và quản trị hệ thống.
- `WorkspaceSetting`: AI, Pexels, múi giờ, lịch mặc định và tùy chọn riêng của workspace.

Facebook App ID, App Secret và token phải được lưu trong `FacebookConnection`, không tiếp tục lưu dưới dạng các key `facebook.*` trong bảng setting chung.

### 3.6 Post và AutoPilot

Thêm `workspaceId` và `brandId` vào `Post`. Vẫn giữ `pageId` là đích đăng cụ thể.

AutoPilot nên có hai tầng:

- `BrandAutomationPreset`: cấu hình mẫu dùng chung cho thương hiệu.
- `AutoPilot`: cấu hình thực thi của từng Page, có thể kế thừa và ghi đè preset.

Bổ sung các trường vận hành:

- `approvalMode`
- `maxPostsPerDay`
- `pauseOnConsecutiveFailures`
- `consecutiveFailures`
- `pausedReason`

## 4. Luồng người dùng

### 4.1 Chọn Workspace

Sau khi đăng nhập:

1. Nếu chưa có workspace, đưa người dùng tới luồng tạo workspace.
2. Nếu chỉ có một workspace, mở trực tiếp workspace đó.
3. Nếu có nhiều workspace, mở workspace gần nhất và hiển thị workspace switcher trên sidebar.

Route đề xuất:

- `/w/[workspaceSlug]/dashboard`
- `/w/[workspaceSlug]/brands`
- `/w/[workspaceSlug]/facebook-connections`
- `/w/[workspaceSlug]/pages`
- `/w/[workspaceSlug]/composer`
- `/w/[workspaceSlug]/calendar`
- `/w/[workspaceSlug]/autopilot`
- `/w/[workspaceSlug]/media`
- `/w/[workspaceSlug]/history`
- `/w/[workspaceSlug]/settings`

### 4.2 Thêm Facebook Graph API vào Workspace

Luồng kết nối:

1. Mở trang “Facebook Apps” trong workspace.
2. Chọn “Thêm Facebook App”.
3. Nhập tên connection, App ID, App Secret và thông tin xác thực.
4. Mã hóa secret trước khi lưu.
5. Kiểm tra kết nối với Facebook Graph API.
6. Lấy danh sách Page mà token có quyền truy cập.
7. Cho phép người dùng chọn các Page cần nhập.
8. Lưu Page cùng `connectionId` tương ứng.
9. Gán Page vào Brand hiện có hoặc tạo Brand mới.

Mỗi Facebook Connection cần hỗ trợ:

- Kiểm tra kết nối.
- Đồng bộ lại danh sách Page.
- Cập nhật token.
- Xem trạng thái và thời điểm hết hạn.
- Tạm vô hiệu hóa.
- Chuyển Page sang connection khác.
- Xóa an toàn khi không còn Page phụ thuộc.

### 4.3 Quản lý nhiều Page

Trang Page cần hỗ trợ:

- Lọc theo Brand, Facebook Connection và trạng thái.
- Tìm kiếm theo tên hoặc Facebook Page ID.
- Chọn nhiều Page để bật hoặc tắt AutoPilot.
- Áp dụng preset cho nhiều Page.
- Hiển thị connection đang cấp quyền đăng.
- Hiển thị cảnh báo token hết hạn hoặc Page mất quyền.
- Bulk schedule có kiểm soát.

Không ưu tiên bulk publish tức thời trong phiên bản đầu. Bulk schedule an toàn hơn, dễ kiểm soát lỗi và giảm nguy cơ đăng trùng.

### 4.4 Quản lý nhiều thương hiệu

Mỗi Brand có:

- Hồ sơ thương hiệu.
- Ngôn ngữ và giọng điệu.
- Trụ cột nội dung.
- Kho tài liệu.
- Danh sách Page.
- Preset AutoPilot.
- Lịch nội dung hợp nhất.
- Báo cáo hiệu quả trong giai đoạn sau.

Composer chọn Brand trước, sau đó chọn một hoặc nhiều Page thuộc Brand. Khi đăng lên nhiều Page, hệ thống tạo một bản ghi Post riêng cho từng Page để trạng thái, retry và Facebook Post ID được theo dõi độc lập.

## 5. Kiến trúc dịch vụ Facebook

Tách logic hiện tại thành các lớp:

- `FacebookConnectionService`: tạo, cập nhật, kiểm tra và vô hiệu hóa connection.
- `FacebookTokenService`: mã hóa, giải mã, kiểm tra hạn và cập nhật token.
- `FacebookPageSyncService`: lấy Page từ đúng connection và upsert an toàn.
- `FacebookPublisher`: đăng bài bằng Page token và connection tương ứng.
- `FacebookErrorClassifier`: phân loại lỗi token, quyền, rate limit và lỗi tạm thời.

Các action không được tự đọc cấu hình Facebook toàn cục. Mọi thao tác đăng bài phải bắt đầu từ Page nội bộ, sau đó truy ra `FacebookConnection` ở phía server.

## 6. Scheduler và đăng bài tự động

Scheduler xử lý theo từng Post:

1. Lấy Post đến hạn và khóa bản ghi để tránh xử lý trùng.
2. Kiểm tra workspace, Brand và Page còn hoạt động.
3. Truy ra Facebook Connection của Page.
4. Kiểm tra trạng thái connection và token.
5. Thực hiện đăng bài.
6. Ghi Facebook Post ID, connection đã dùng, request ID và kết quả.
7. Retry lỗi tạm thời bằng exponential backoff.
8. Không retry tự động với lỗi thiếu quyền hoặc token hết hạn.
9. Tạm dừng AutoPilot của Page nếu lỗi liên tiếp vượt ngưỡng.

Khi triển khai production đa tenant, chuyển sang PostgreSQL và dùng BullMQ/Redis hoặc hàng đợi tương đương. Worker phải có idempotency key để một Post không bị đăng hai lần.

## 7. Bảo mật và cách ly dữ liệu

- Mã hóa App Secret, user token và Page token bằng AES-256-GCM.
- Khóa mã hóa nằm trong biến môi trường hoặc secret manager, không lưu trong database.
- Không gửi secret đầy đủ về client sau khi lưu.
- Redact token và secret khỏi log, thông báo lỗi và audit payload.
- Kiểm tra membership và role trong DAL cho tất cả truy vấn workspace.
- Không truy vấn tài nguyên chỉ bằng ID mà thiếu `workspaceId` hoặc ownership guard.
- Thêm audit log cho thao tác kết nối Facebook, cập nhật token, đồng bộ Page, đổi Brand và đăng bài.
- Xóa workspace theo quy trình soft delete trước, hard delete sau.
- Cân nhắc envelope encryption khi chuyển thành SaaS.

## 8. Phân quyền

- `OWNER`: quản lý workspace, thành viên, tích hợp, billing và xóa workspace.
- `ADMIN`: quản lý Brand, Page, Facebook Connection và automation.
- `EDITOR`: tạo, sửa, duyệt và lên lịch nội dung.
- `VIEWER`: chỉ xem dashboard, lịch và lịch sử.

Phiên bản đầu có thể chỉ kích hoạt `OWNER` và `ADMIN`, nhưng schema và authorization helper nên chuẩn bị sẵn cho đủ bốn role.

## 9. Migration dữ liệu hiện tại

Thực hiện migration không làm mất dữ liệu:

1. Sao lưu `dev.db` bằng cơ chế backup hiện có.
2. Tạo workspace mặc định cho admin hiện tại.
3. Tạo `WorkspaceMember` với role `OWNER`.
4. Chuyển từng `BrandProfile` hiện có thành một Brand hoặc tạo Brand mặc định phù hợp.
5. Tạo một `FacebookConnection` mặc định từ cấu hình Facebook hiện tại.
6. Gán toàn bộ Facebook Page hiện có vào workspace và connection mặc định.
7. Backfill `workspaceId` và `brandId` cho Post, Media, AutoPilot, Content Pillar và Knowledge Document.
8. Kiểm tra bản ghi mồ côi và quan hệ sai.
9. Chuyển các cột mới từ nullable sang bắt buộc khi backfill hoàn tất.
10. Chỉ xóa key Facebook cũ trong `AppSetting` sau khi xác minh connection mới hoạt động.

Script migration phải:

- So sánh số lượng bản ghi trước và sau.
- Có kiểm tra dữ liệu mồ côi.
- Có phương án rollback.
- Từ chối chạy nếu database test và database thật bị cấu hình nhầm.

## 10. Kế hoạch triển khai

> **TIẾN ĐỘ (cập nhật sau lần thực thi đầu):** Giai đoạn 0, 1, 2 và phần lõi
> của 3–5 đã triển khai: schema + migration backfill (không mất dữ liệu),
> DAL workspace, service đa connection, sync/đăng theo connection, giao diện
> `/facebook-apps` + `/pages`, composer hiển thị brand, autopilot gán
> workspace/brand. Kiểm thử: 25 test đa workspace + 92 test logic cũ đạt.

### Giai đoạn 0: Khảo sát và đặc tả ✅

- Lập bản đồ các truy vấn đang phụ thuộc trực tiếp vào `userId`.
- Tìm mọi nơi đọc `AppSetting` và cấu hình Facebook toàn cục.
- Xác định luồng sync, publish, retry, cron và AutoPilot hiện tại.
- Chốt quy tắc xử lý Page trùng giữa nhiều connection.
- Viết tài liệu quyết định kiến trúc cho Workspace và Facebook Connection.

**Hoàn thành khi:** có danh sách file cần sửa, sơ đồ quan hệ, checklist migration và danh sách rủi ro.

### Giai đoạn 1: Nền tảng Workspace ✅ (lõi xong — UI switcher còn đơn giản)

- Thêm `Workspace` và `WorkspaceMember`.
- Tạo workspace mặc định và backfill dữ liệu.
- Xây DAL kiểm tra membership và role.
- Thêm workspace switcher.
- Chuyển dashboard sang route có workspace.

**Hoàn thành khi:** một User tạo được nhiều workspace và không thể xem dữ liệu chéo workspace.

### Giai đoạn 2: Nhiều Facebook Graph API trong Workspace ✅

- Thêm `FacebookConnection`.
- Di chuyển cấu hình Facebook khỏi `AppSetting`.
- Xây CRUD và giao diện quản lý connection.
- Kiểm tra token, trạng thái và hạn sử dụng.
- Đồng bộ Page độc lập từ từng connection.
- Gắn `FacebookPage.connectionId`.

**Hoàn thành khi:** một workspace thêm được ít nhất hai Facebook App và đồng bộ Page độc lập từ mỗi App.

### Giai đoạn 3: Đa thương hiệu ✅ (làm lại theo thực tế)

- Thêm `Brand`. ✅
- Chuyển dữ liệu Brand Profile hiện tại. ✅ (migration backfill)
- Gán Page vào Brand. ✅ (`assignPageToBrand`, UI `/pages` + panel trong `/brand`)
- Chuyển Content Pillar và Knowledge Document sang Brand. ✅ (`brand_content_decoupled` —
  BrandProfile bỏ `pageId`, Pillar/Doc nullable `pageId`, mọi truy vấn theo `brandId`)
- Thêm brand switcher, bộ lọc và dashboard theo Brand. ✅ (`/brand?brand=<id>`:
  danh sách + tạo/sửa/xoá thương hiệu, editor 3 tab theo brand)

**Hoàn thành khi:** một workspace quản lý được nhiều Brand và mỗi Brand có nhiều Page cùng dữ liệu nội dung riêng. ✅
Trang Tự động đăng giờ là bảng quản lý nhiều cấu hình (mỗi Page một dòng, bật/tắt
tất cả). Trang Cài đặt đã xoá khối Facebook Graph API (chuyển sang `/facebook-apps`).

### Giai đoạn 4: Composer và lịch đa Page (một phần ✅)

- Composer chọn Brand. ✅ (dropdown "Viết theo thương hiệu" — AI dùng hồ sơ +
  trụ cột + kho tài liệu của brand; tự đồng bộ theo Page, ghi đè thủ công được.
  Kèm khối "Tìm ảnh/video nhanh trên Pexels" ngay trong form: tìm/gợi ý từ khóa
  theo nội dung + ngành hàng brand, đính kèm 1 nút bấm.)
- Composer chọn nhiều Page. (còn lại — bulk đa Page)
- Tạo Post riêng cho từng Page. (còn lại — kèm mục trên)
- Thêm bulk schedule, bulk pause và bulk retry. (còn lại)
- Thêm lịch hợp nhất theo workspace, Brand và Page. (còn lại)

**Hoàn thành khi:** một chiến dịch có thể tạo nội dung cho nhiều Page trong khi kết quả từng Page vẫn được theo dõi độc lập.

### Giai đoạn 5: AutoPilot đa Page

- Thêm preset ở cấp Brand.
- Cho Page kế thừa hoặc ghi đè preset.
- Phân phối thời gian để các Page không đăng đồng loạt ngoài ý muốn.
- Thêm giới hạn tần suất và circuit breaker khi lỗi liên tiếp.

**Hoàn thành khi:** nhiều Page chạy AutoPilot độc lập và lỗi của một Page hoặc connection không làm dừng toàn workspace.

### Giai đoạn 6: Hàng đợi và độ tin cậy

- Chuyển production sang PostgreSQL.
- Thêm Redis và BullMQ hoặc hàng đợi tương đương.
- Thêm idempotency, distributed lock, retry và dead-letter handling.
- Thêm dashboard theo dõi connection và worker.

**Hoàn thành khi:** không đăng trùng khi worker chạy song song hoặc tiến trình bị khởi động lại.

### Giai đoạn 7: Quản trị và báo cáo

- Thêm audit log.
- Báo cáo theo workspace, Brand, Page và connection.
- Theo dõi token sắp hết hạn, lỗi quyền và tỷ lệ đăng thành công.
- Thêm lời mời thành viên và RBAC đầy đủ.

## 11. Chiến lược kiểm thử

### Unit test

- Membership và role guard.
- Mã hóa và giải mã secret.
- Page deduplication.
- Chọn đúng connection cho Page.
- Kế thừa và ghi đè preset AutoPilot.
- Idempotency và phân loại lỗi Facebook.

### Integration test

- User không thể đọc hoặc sửa workspace khác.
- Hai workspace có thể dùng cùng App ID nhưng dữ liệu vẫn cách ly.
- Một workspace có nhiều Facebook Connection.
- Mỗi connection chỉ đồng bộ các Page của chính nó.
- Vô hiệu hóa một connection không ảnh hưởng connection khác.
- Token hết hạn chỉ chặn những Page thuộc connection đó.

### E2E test

- Tạo workspace → tạo Brand → thêm Facebook App → sync Page → gán Brand → tạo bài → lên lịch → worker đăng.
- Chuyển workspace không làm rò rỉ Page, Brand, Post hoặc setting.
- Một bài đa Page tạo nhiều delivery độc lập.
- Retry một Page không đăng lại những Page đã thành công.
- Migration giữ nguyên dữ liệu hiện tại.

Tiếp tục duy trì database test tách biệt và bổ sung fixture cho nhiều workspace, nhiều connection và tình huống Page trùng.

## 12. Giao diện chính

Sidebar cấp workspace:

- Tổng quan
- Thương hiệu
- Facebook Apps
- Facebook Pages
- Composer
- Lịch nội dung
- AutoPilot
- Thư viện Media
- Lịch sử
- Thành viên
- Cài đặt

Dashboard hiển thị:

- Số Brand và Page đang hoạt động.
- Trạng thái từng Facebook Connection.
- Token sắp hết hạn.
- Bài chờ duyệt, đã lên lịch, thành công và thất bại.
- AutoPilot đang chạy hoặc bị tạm dừng.

## 13. Rủi ro và biện pháp giảm thiểu

- **Rò rỉ dữ liệu giữa workspace:** bắt buộc kiểm tra membership tại DAL và có negative authorization test.
- **Token hoặc App Secret bị lộ:** mã hóa, che log và không trả secret về client.
- **Page trùng giữa nhiều Facebook App:** unique theo workspace và có quy trình chuyển connection.
- **Đăng trùng:** dùng idempotency key, lock và trạng thái xử lý.
- **Một Facebook App lỗi làm dừng toàn hệ thống:** cô lập lỗi theo connection và Page.
- **Migration làm mất dữ liệu:** backup, backfill nhiều bước, kiểm tra số lượng và rollback plan.
- **AutoPilot đăng quá nhiều Page cùng lúc:** giới hạn tần suất, thêm jitter lịch và quota theo workspace hoặc connection.
- **SQLite không phù hợp worker song song:** giữ SQLite khi phát triển nhưng chuyển PostgreSQL trước khi vận hành đa tenant thực tế.

## 14. MVP đa Workspace ưu tiên

Phiên bản đầu chỉ cần:

1. Một User có nhiều Workspace.
2. Một Workspace có nhiều Facebook Connection.
3. Mỗi Facebook Connection đồng bộ được nhiều Page.
4. Một Workspace có nhiều Brand.
5. Page được gán vào Brand và Connection.
6. Post, Media, AutoPilot và Calendar được cách ly theo Workspace.
7. Scheduler chọn đúng connection theo Page.
8. Dashboard và bộ lọc hỗ trợ nhiều Page.
9. Migration giữ nguyên dữ liệu hiện có.

Chưa cần triển khai ngay billing, analytics nâng cao, lời mời thành viên hoặc nhiều mạng xã hội. Các phần này thực hiện sau khi nền tảng tenant và Facebook Connection ổn định.

## 15. Tiêu chí nghiệm thu tổng thể

- Một tài khoản tạo và chuyển đổi được giữa ít nhất hai workspace.
- Mỗi workspace thêm được nhiều Facebook Graph API App.
- Các connection trong cùng workspace lấy được những nhóm Page khác nhau.
- Một Page luôn xác định được connection dùng để đăng.
- Một workspace quản lý được nhiều Brand và nhiều Page cho từng Brand.
- Không có truy vấn hoặc action làm lộ dữ liệu giữa hai workspace.
- AutoPilot và scheduler chạy độc lập trên nhiều Page.
- Lỗi hoặc token hết hạn của một connection không ảnh hưởng connection khác.
- Không đăng trùng khi retry hoặc worker chạy đồng thời.
- Dữ liệu hiện tại được giữ nguyên sau migration.
- Các bộ test hiện có tiếp tục chạy và có thêm test đa workspace, đa Brand và đa Facebook Connection.
