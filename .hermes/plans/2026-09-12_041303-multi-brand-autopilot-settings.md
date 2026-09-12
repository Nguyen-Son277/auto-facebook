# Kế hoạch tái cấu trúc nhiều thương hiệu và nhiều cấu hình tự động đăng

## Goal

Chuyển ứng dụng từ mô hình gần như một thương hiệu mặc định sang mô hình quản lý nhiều thương hiệu độc lập, nhiều cấu hình tự động đăng, đồng thời loại bỏ cấu hình Facebook Graph API khỏi trang Cài đặt.

## Current context / assumptions

- Dự án dùng Next.js 16 App Router, TypeScript, Prisma 7 và SQLite trong môi trường phát triển.
- Working tree đang có nhiều thay đổi chưa commit, gồm migration `prisma/migrations/20260912022242_multi_workspace_tenants/`, model `Brand`, `Workspace`, `FacebookConnection`, cùng thay đổi ở Pages, Composer, Facebook và Scheduler.
- Không được ghi đè hoặc hoàn tác các thay đổi hiện tại. Trước mỗi bước, implementer phải kiểm tra `git diff` và phân biệt thay đổi của người dùng với thay đổi của tác vụ.
- `Brand` phải là thực thể cấp workspace. Mỗi brand có hồ sơ, tài liệu kiến thức và content pillars riêng.
- Một brand có thể liên kết nhiều Facebook Page. Một Facebook Page chỉ thuộc tối đa một brand trong một workspace.
- Mỗi cấu hình AutoPilot là một automation độc lập, có tên riêng, brand, Facebook Page, lịch chạy, content pillar, trạng thái và thời điểm chạy tiếp theo.
- Yêu cầu “xóa Facebook Graph API khỏi Cài đặt” được hiểu là xóa trường nhập token/version/base URL thủ công khỏi `/settings`. Kết nối Facebook vẫn được quản lý qua Facebook App/connection và Page đã đồng bộ, không xóa mã gọi Facebook Graph API khỏi tầng tích hợp.
- Không thay đổi SQLite sang PostgreSQL trong kế hoạch này. Đây là việc deploy riêng.

## Architecture / proposed approach

Dùng `Workspace` làm ranh giới dữ liệu, `Brand` làm aggregate root cho Brand Profile, KnowledgeDoc và ContentPillar. Các thao tác brand và autopilot phải luôn lọc bằng workspace hiện tại, không chỉ bằng ID do client gửi lên. Tách trang danh sách và trang chỉnh sửa chi tiết để CRUD rõ ràng, tránh tiếp tục mở rộng một form singleton lớn.

Facebook credentials không còn thuộc Settings chung. Trang Settings chỉ giữ AI, Pexels và thiết lập ứng dụng; thông tin Facebook được lấy từ `FacebookConnection` liên kết vớ��i Page khi publish hoặc scheduler chạy.

## Step-by-step tasks

### Task 0: Cố định baseline và bảo vệ thay đổi hiện có

1. Chạy các lệnh chỉ đọc:

```bash
git status --short
git diff --stat
git diff -- prisma/schema.prisma src/app/actions/brand.ts src/lib/autopilot.ts src/app/actions/settings.ts
```

Expected:

- Hiển thị các file người dùng đang sửa.
- Không có file nào bị reset hoặc checkout.

2. Chạy baseline:

```bash
npm run lint
npm run build
```

Expected:

- Ghi lại chính xác số lỗi hiện có trước khi sửa.
- Nếu baseline không pass, lưu output vào ghi chú triển khai và không quy lỗi cũ cho thay đổi mới.

3. Kiểm tra migration đang viết dở:

```bash
npx prisma validate
npx prisma migrate status
```

Expected:

- `prisma/schema.prisma` hợp lệ.
- Xác định migration `20260912022242_multi_workspace_tenants` đã áp dụng vào DB nào.

Không commit Task 0.

### Task 1: Khóa mô hình dữ liệu nhiều thương hiệu bằng test thất bại

Files:

- `scripts/test-multi-workspace.mjs`
- `prisma/schema.prisma`
- migration mới trong `prisma/migrations/<timestamp>_brand_crud_autopilot_scope/migration.sql`

RED:

Mở rộng `scripts/test-multi-workspace.mjs` để kiểm tra:

1. Một workspace tạo được ít nhất hai Brand.
2. Slug chỉ unique trong cùng workspace.
3. Brand A và Brand B có KnowledgeDoc và ContentPillar riêng.
4. Không thể truy cập hoặc sửa Brand của workspace khác.
5. Xóa brand không được phép khi còn FacebookPage, Post hoặc AutoPilot phụ thuộc.
6. AutoPilot có `name`, `workspaceId`, `brandId`, `pageId` và có thể có nhiều record cho cùng user.
7. `AutoPilot.brandId` và `AutoPilot.pageId` bắt buộc thuộc cùng workspace.

Chạy:

```bash
npm run test:db:prepare
node scripts/test-multi-workspace.mjs
```

Expected RED:

- Test mới thất bại vì schema hoặc ràng buộc AutoPilot chưa đầy đủ.

GREEN:

Điều chỉnh `prisma/schema.prisma` theo cấu trúc tối thiểu sau, nhưng giữ các field nghiệp vụ hiện có:

```prisma
model Brand {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  slug        String
  description String?  @default("")
  voice       String?  @default("")
  audience    String?  @default("")
  messaging   String?  @default("")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace      Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  knowledgeDocs  KnowledgeDoc[]
  contentPillars ContentPillar[]
  pages           FacebookPage[]
  posts           Post[]
  autoPilots      AutoPilot[]

  @@unique([workspaceId, slug])
  @@index([workspaceId, updatedAt])
}
```

Bổ sung vào `AutoPilot` mà không tạo model automation thứ hai:

```prisma
name        String
workspaceId String
brandId     String
pageId      String

workspace Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
brand     Brand        @relation(fields: [brandId], references: [id], onDelete: Restrict)
page      FacebookPage @relation(fields: [pageId], references: [id], onDelete: Restrict)

@@index([workspaceId, enabled, nextRunAt])
@@index([brandId])
@@index([pageId])
```

Migration phải backfill dữ liệu cũ trước khi chuyển cột sang required. Không xóa dữ liệu hiện có.

Chạy:

```bash
npx prisma format
npx prisma validate
npm run test:db:prepare
node scripts/test-multi-workspace.mjs
```

Expected GREEN:

- Prisma validation thành công.
- Test kết thúc với `0 lỗi`.

Commit:

```bash
git add prisma/schema.prisma prisma/migrations scripts/test-multi-workspace.mjs
git commit -m "feat: scope brands and automations by workspace"
```

### Task 2: Tạo service CRUD Brand có kiểm tra quyền sở hữu

Files:

- Create `src/lib/brands.ts`
- Update `src/app/actions/brand.ts`
- Create `scripts/test-brand-crud.mjs`

RED:

Viết `scripts/test-brand-crud.mjs` kiểm tra hành vi service:

- List chỉ trả brand của workspace hiện tại.
- Create chuẩn hóa tên và sinh slug.
- Trùng slug trong workspace trả lỗi rõ ràng.
- Update không sửa được `workspaceId`.
- Delete brand rỗng thành công.
- Delete brand còn dependency trả mã `BRAND_IN_USE` và số lượng dependency.
- ID của workspace khác luôn trả `NOT_FOUND`.

Chạy:

```bash
npm run test:db:prepare
node scripts/test-brand-crud.mjs
```

Expected RED: module hoặc các hàm CRUD chưa tồn tại.

GREEN:

Trong `src/lib/brands.ts`, export đúng các hàm:

```ts
export async function listBrands(workspaceId: string): Promise<BrandSummary[]>;
export async function getBrand(workspaceId: string, brandId: string): Promise<BrandEditorData | null>;
export async function createBrand(workspaceId: string, input: BrandInput): Promise<ActionResult>;
export async function updateBrand(workspaceId: string, brandId: string, input: BrandInput): Promise<ActionResult>;
export async function deleteBrand(workspaceId: string, brandId: string): Promise<ActionResult>;
```

Yêu cầu implementation:

- Mọi `findFirst`, `updateMany` hoặc transaction đều chứa cả `id` và `workspaceId`.
- Dùng transaction cho delete và kiểm tra dependency.
- Không nhận `workspaceId` từ FormData.
- `src/app/actions/brand.ts` phải lấy workspace từ DAL/session hiện có rồi gọi service.
- Revalidate `/brand`, `/brand/[id]`, `/composer`, `/autopilot` sau mutation phù hợp.

Chạy:

```bash
node scripts/test-brand-crud.mjs
npm run lint
```

Expected GREEN: test `0 lỗi`, lint không có lỗi mới.

Commit:

```bash
git add src/lib/brands.ts src/app/actions/brand.ts scripts/test-brand-crud.mjs
git commit -m "feat: add workspace-safe brand CRUD"
```

### Task 3: Chuyển Hồ sơ thương hiệu thành danh sách CRUD

Files:

- Update `src/app/(dashboard)/brand/page.tsx`
- Create `src/app/(dashboard)/brand/new/page.tsx`
- Create `src/app/(dashboard)/brand/[id]/page.tsx`
- Create `src/components/brand-list.tsx`
- Refactor `src/components/brand-editor.tsx`
- Create `scripts/e2e-brand-crud.mjs`
- Update `package.json`

RED:

Tạo `scripts/e2e-brand-crud.mjs` với Playwright theo pattern các E2E scripts hiện có:

1. Đăng nhập test.
2. Mở `/brand` và thấy empty state hoặc danh sách.
3. Tạo “Gigone” và “Mobile Oasis”.
4. Tên và slug của cả hai xuất hiện trong danh sách.
5. Mở từng brand và sửa hồ sơ độc lập.
6. Thêm KnowledgeDoc và ContentPillar riêng cho từng brand.
7. Xóa brand rỗng thành công.
8. Xóa brand đang được Page hoặc AutoPilot sử dụng bị chặn với thông báo dependency.

Thêm script:

```json
"test:e2e:brands": "node scripts/e2e-brand-crud.mjs"
```

Chạy:

```bash
npm run test:e2e:brands
```

Expected RED: route `/brand/new` hoặc `/brand/[id]` chưa tồn tại.

GREEN:

UI bắt buộc:

- `/brand`: tiêu đề “Hồ sơ thương hiệu”, nút “Tạo thương hiệu”, danh sách card hoặc table.
- Mỗi dòng có `Sửa`, `Xóa`, số Page, số Content Pillar, số tài liệu, số automation.
- `/brand/new`: chỉ chứa form tạo brand cơ bản.
- `/brand/[id]`: chỉnh hồ� sơ, tài liệu kiến thức và content pillars của đúng brand.
- Nút xóa dùng confirm dialog và hiển thị lý do khi brand đang được sử dụng.
- Không dùng state singleton cho toàn bộ user.

Chạy:

```bash
npm run test:e2e:brands
npm run lint
npm run build
```

Expected GREEN: E2E pass, lint pass, build tạo production bundle thành công.

Commit:

```bash
git add src/app/'(dashboard)'/brand src/components/brand-list.tsx src/components/brand-editor.tsx scripts/e2e-brand-crud.mjs package.json
git commit -m "feat: add multi-brand management UI"
```

### Task 4: Buộc Composer, Pages và bài viết dùng brand rõ ràng

Files:

- Update `src/app/(dashboard)/composer/page.tsx`
- Update `src/components/composer-studio.tsx`
- Update `src/app/actions/composer.ts`
- Update `src/app/actions/pages.ts`
- Update `src/app/(dashboard)/pages/page.tsx`
- Update `src/app/actions/publish.ts`
- Update `src/lib/posts.ts`
- Update `scripts/e2e-composer.mjs`

RED:

Mở rộng E2E để kiểm tra:

- Composer bắt buộc chọn brand trước Page/pillar.
- Page dropdown chỉ hiển thị Page thuộc brand đã chọn.
- Pillar chỉ hiển thị pillar thuộc brand đã chọn.
- Server từ chối request ghép `brandId` của Brand A với `pageId` hoặc pillar của Brand B.
- Post được lưu với đúng `workspaceId` và `brandId`.

Chạy:

```bash
npm run test:e2e:composer
```

Expected RED: composer chưa lọc hoàn toàn theo brand hoặc server chưa chặn cross-brand IDs.

GREEN:

- Client dùng cascade `brandId -> pageId/contentPillarId`.
- Server không tin dropdown client; query lại Page và ContentPillar bằng `workspaceId + brandId + id`.
- Khi Page đã gắn brand, việc publish lấy brand từ Page hoặc xác minh brand gửi lên khớp Page.
- Không tự chọn brand đầu tiên nếu workspace có nhiều brand.

Chạy:

```bash
npm run test:e2e:composer
node scripts/test-multi-workspace.mjs
npm run lint
```

Expected GREEN: không có cross-brand data leak, các test pass.

Commit:

```bash
git add src/app/'(dashboard)'/composer src/components/composer-studio.tsx src/app/actions/composer.ts src/app/actions/pages.ts src/app/'(dashboard)'/pages/page.tsx src/app/actions/publish.ts src/lib/posts.ts scripts/e2e-composer.mjs
git commit -m "feat: scope composer and posts to brands"
```

### Task 5: Tạo service quản lý nhiều AutoPilot

Files:

- Update `src/lib/autopilot.ts`
- Update `src/app/actions/autopilot.ts`
- Create `scripts/test-autopilot-crud.mjs`

RED:

Viết test cho:

- Tạo hai AutoPilot trong cùng workspace.
- Mỗi AutoPilot có tên, brand, Page và lịch riêng.
- Có thể sửa, bật, tắt, chạy thử và xóa từng AutoPilot độc lập.
- Không thể gắn Page của Brand B vào automation của Brand A.
- Không thể sửa/xóa automation của workspace khác.
- Xóa một automation không ảnh hưởng automation khác.

Chạy:

```bash
npm run test:db:prepare
node scripts/test-autopilot-crud.mjs
```

Expected RED: API hiện tại chưa cung cấp CRUD đầy đủ hoặc chưa scope workspace.

GREEN:

Export interface rõ ràng trong `src/lib/autopilot.ts`:

```ts
export async function listAutoPilots(workspaceId: string): Promise<AutoPilotSummary[]>;
export async function getAutoPilot(workspaceId: string, id: string): Promise<AutoPilotEditorData | null>;
export async function createAutoPilot(workspaceId: string, input: AutoPilotInput): Promise<ActionResult>;
export async function updateAutoPilot(workspaceId: string, id: string, input: AutoPilotInput): Promise<ActionResult>;
export async function setAutoPilotEnabled(workspaceId: string, id: string, enabled: boolean): Promise<ActionResult>;
export async function deleteAutoPilot(workspaceId: string, id: string): Promise<ActionResult>;
```

Validation dùng chung phải kiểm tra brand, Page, pillar và connection cùng workspace trước mutation.

Chạy:

```bash
node scripts/test-autopilot-crud.mjs
npm run lint
```

Expected GREEN: test pass và không có lỗi lint mới.

Commit:

```bash
git add src/lib/autopilot.ts src/app/actions/autopilot.ts scripts/test-autopilot-crud.mjs
git commit -m "feat: add workspace-safe autopilot CRUD"
```

### Task 6: Chuyển Tự động đăng thành danh sách nhiều automation

Files:

- Update `src/app/(dashboard)/autopilot/page.tsx`
- Create `src/app/(dashboard)/autopilot/new/page.tsx`
- Create `src/app/(dashboard)/autopilot/[id]/page.tsx`
- Refactor `src/components/autopilot-dashboard.tsx`
- Create `src/components/autopilot-list.tsx`
- Update `scripts/e2e-week5.mjs`

RED:

Mở rộng E2E:

1. Tạo hai automation với hai tên khác nhau.
2. Chọn brand trước, rồi chỉ thấy Page và pillar thuộc brand đó.
3. Bật/tắt automation thứ nhất không đổi automation thứ hai.
4. Sửa lịch automation thứ hai độc lập.
5. Xóa automation thứ nhất, automation thứ hai vẫn tồn tại.
6. Danh sách hiển thị trạng thái, brand, Page, lịch, last run, next run và lỗi gần nhất.

Chạy:

```bash
npm run test:e2e:week5
```

Expected RED: trang hiện tại chưa có list/detail CRUD đầy đủ.

GREEN:

- `/autopilot`: danh sách và nút “Tạo tự động đăng”.
- `/autopilot/new`: form tạo mới.
- `/autopilot/[id]`: form sửa và lịch sử chạy của một automation.
- Action bật/tắt và xóa áp dụng theo ID, không dùng `findFirst({ userId })` singleton.
- Xóa cần confirm dialog.

Chạy:

```bash
npm run test:e2e:week5
npm run lint
npm run build
```

Expected GREEN: E2E, lint và build pass.

Commit:

```bash
git add src/app/'(dashboard)'/autopilot src/components/autopilot-dashboard.tsx src/components/autopilot-list.tsx scripts/e2e-week5.mjs
git commit -m "feat: add multi-autopilot management UI"
```

### Task 7: Cập nhật scheduler để xử lý nhiều AutoPilot an toàn

Files:

- Update `src/lib/scheduler.ts`
- Update `src/lib/autopilot.ts`
- Update `src/app/api/cron/tick/route.ts` nếu contract kết quả cần thay đổi
- Update `scripts/e2e-scheduler-inapp.mjs`
- Update `scripts/e2e-week6.mjs`

RED:

Bổ sung test:

- Hai automation đến hạn đều được xử lý.
- Failure của automation A không ngăn automation B chạy.
- Mỗi automation dùng đúng brand context, Page connection và pillar.
- `nextRunAt`, `lastRunAt`, `lastError` được cập nhật theo từng record.
- Lock/idempotency ngăn một automation được publish hai lần trong cùng tick.

Chạy:

```bash
npm run test:e2e:scheduler
npm run test:e2e:week6
```

Expected RED: scheduler còn giả định một AutoPilot hoặc thiếu isolation lỗi.

GREEN:

- Query tất cả automation `enabled = true` và `nextRunAt <= now`.
- Xử lý theo ID, với try/catch từng automation.
- Lấy brand context bằng `autoPilot.brandId`.
- Lấy Facebook connection qua Page/connection hiện có, không qua Settings.
- Trả summary gồm processed, succeeded, failed và skipped.

Chạy:

```bash
npm run test:e2e:scheduler
npm run test:e2e:week6
npm run lint
```

Expected GREEN: tất cả automation độc lập và test pass.

Commit:

```bash
git add src/lib/scheduler.ts src/lib/autopilot.ts src/app/api/cron/tick/route.ts scripts/e2e-scheduler-inapp.mjs scripts/e2e-week6.mjs
git commit -m "fix: process multiple automations independently"
```

### Task 8: Xóa cấu hình Facebook Graph API khỏi Settings

Files:

- Update `src/app/(dashboard)/settings/page.tsx`
- Update `src/components/settings-form.tsx`
- Update `src/app/actions/settings.ts`
- Update `src/lib/settings.ts`
- Update `scripts/e2e-settings.mjs`
- Review `src/lib/facebook.ts`
- Review `src/lib/facebook-connection.ts`
- Review `src/app/(dashboard)/facebook-apps/`

RED:

Sửa `scripts/e2e-settings.mjs` để xác nhận:

- `/settings` không còn input cho Facebook Graph API, App ID, App Secret, Page token hoặc Graph version.
- Settings vẫn lưu được AI API key, AI model và Pexels key.
- Publish lấy credential từ `FacebookConnection` gắn với Page.
- Thiếu connection trả thông báo hướng người dùng đến trang Facebook App/Page, không hướng đến Settings.

Chạy:

```bash
npm run test:e2e
```

Expected RED: Settings hiện vẫn render hoặc lưu field Facebook.

GREEN:

- Xóa field và action Facebook khỏi Settings UI và save payload.
- Không xóa `FB_GRAPH_BASE_URL` khỏi mock/test nếu nó chỉ dùng để thay endpoint Facebook trong E2E.
- Không xóa Graph API client trong `src/lib/facebook.ts`; chỉ thay nguồn credential sang `FacebookConnection`.
- Nếu DB còn AppSetting keys cũ, ngừng đọc/ghi trước. Chỉ xóa dữ liệu bằng migration khi đã chứng minh không còn reference và có backup.

Chạy:

```bash
npm run test:e2e
npm run test:e2e:composer
npm run test:e2e:week6
npm run lint
npm run build
```

Expected GREEN: Settings không có Facebook config, publish và scheduler vẫn pass bằng FacebookConnection.

Commit:

```bash
git add src/app/'(dashboard)'/settings src/components/settings-form.tsx src/app/actions/settings.ts src/lib/settings.ts src/lib/facebook.ts src/lib/facebook-connection.ts scripts/e2e-settings.mjs
git commit -m "refactor: move Facebook credentials out of settings"
```

### Task 9: Regression, dữ liệu cũ và documentation

Files:

- Update `README.md`
- Update `PLAN.md` only if it is still the active product plan
- Update `.env.example` if obsolete Facebook settings are listed there

Run full validation:

```bash
npm run db:backup
npm run test:db:prepare
node scripts/test-multi-workspace.mjs
node scripts/test-brand-crud.mjs
node scripts/test-autopilot-crud.mjs
npm run test:e2e
npm run test:e2e:brands
npm run test:e2e:composer
npm run test:e2e:media
npm run test:e2e:scheduler
npm run test:e2e:week5
npm run test:e2e:week6
npm run lint
npm run build
```

Expected:

- Mọi test báo `0 lỗi` hoặc pass.
- Lint exit code 0.
- Build exit code 0.
- `git diff --check` không có whitespace errors.
- `git status --short` chỉ còn các thay đổi chủ ý.

Documentation phải mô tả:

- Cách tạo, sửa, xóa nhiều brand.
- Cách gắn Page với brand.
- Cách tạo nhiều automation.
- Facebook App/connection được quản lý ở đâu.
- Settings không còn nơi nhập Facebook Graph credentials.

Commit:

```bash
git add README.md PLAN.md .env.example
git commit -m "docs: document multi-brand automation workflow"
```

## Tests / validation strategy

Mỗi task code tuân theo RED, GREEN, REFACTOR:

1. Viết hoặc mở rộng test trước.
2. Chạy đúng test và ghi lại failure mong đợi.
3. Viết lượng code tối thiểu để pass.
4. Chạy lại test và các test lân cận.
5. Refactor khi test vẫn xanh.
6. Commit riêng theo task.

Không dùng `dev.db` cho destructive tests. Các scripts phải bị chặn nếu `TEST_DB` trỏ vào `dev.db` hoặc chứa user thật, theo cơ chế bảo vệ hiện có.

Các tầng cần kiểm tra:

- Database integrity: FK, uniqueness, migration/backfill.
- Authorization: mọi query theo workspace.
- Domain consistency: brand, Page, pillar và automation phải cùng workspace/brand.
- UI CRUD: list, create, edit, delete, empty state, dependency errors.
- Scheduler isolation và idempotency.
- Regression của publish, media và Facebook connection.

## Risks and tradeoffs

1. **Working tree đang có thay đổi lớn:** Đây là rủi ro cao nhất. Không được reset, stash hoặc viết đè. Mỗi commit chỉ stage file thuộc task và phải review `git diff --cached` trước commit.
2. **Migration dữ liệu:** Chuyển `brandId` và `workspaceId` sang required có thể làm mất dữ liệu nếu không backfill. Luôn backup DB và kiểm tra `PRAGMA foreign_key_check`.
3. **Ý nghĩa “Facebook đã thiết lập ở Facebook App”:** Facebook App không tự cung cấp Page access token cho ứng dụng nếu không có OAuth/connection flow. Kế hoạch giữ `FacebookConnection` và chỉ bỏ credential khỏi Settings.
4. **Xóa brand:** Cascade có thể xóa nội dung quan trọng. Mặc định dùng Restrict khi còn Page, Post hoặc AutoPilot. Chỉ cascade đối với dữ liệu con thuần túy như draft knowledge/pillars nếu product owner đồng ý.
5. **Slug:** Slug được giữ unique trong workspace, không global, để hai workspace có thể cùng dùng một tên brand.
6. **UI complexity:** Tách list/create/detail tăng số route nhưng giảm state phức tạp và dễ mở rộng hơn form singleton.
7. **Testing scripts hiện tại:** Dự án dùng các script E2E tùy biến thay vì test runner unit chuẩn. Kế hoạch tận dụng cách hiện tại để YAGNI, chưa thêm Vitest nếu chưa cần.

## Open questions for product owner

Các mặc định dưới đây được dùng khi triển khai nếu không có chỉ đạo khác:

1. Khi xóa brand có dependency, mặc định chặn xóa và liệt kê Page/Post/AutoPilot đang dùng, không cascade.
2. Một Page mặc định chỉ thuộc một brand tại một thời điểm.
3. Một automation mặc định chỉ đăng lên một Page. Muốn đăng nhiều Page thì tạo nhiều automation để lịch sử và lỗi độc lập.
4. Facebook App và OAuth/Page connection được quản lý ở mục Facebook Apps/Pages, không ở Settings.
5. Brand selection là bắt buộc trong Composer và AutoPilot khi workspace có từ hai brand trở lên.
6. Bản kế hoạch này không bao gồm PostgreSQL, Vercel Blob hoặc deploy Vercel.