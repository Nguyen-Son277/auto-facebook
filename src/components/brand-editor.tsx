"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createDefaultPillars,
  deleteKnowledgeDoc,
  deletePillar,
  saveBrandProfile,
  saveKnowledgeDoc,
  savePillar,
  toggleKnowledgeDoc,
  togglePillar,
  type BrandState,
} from "@/app/actions/brand";
import { TONES, GOALS, docKindLabel } from "@/lib/ai-prompts";
import { autoPilotConfirmPrompt } from "@/lib/brand-scope";

// ============================================================
// Trang Hồ sơ thương hiệu — giao diện.
//
// Ba khối, xếp theo mức độ quan trọng với AI:
//   1. Thông tin cơ bản  — AI đọc mọi lần viết bài
//   2. Trụ cột nội dung  — quyết định "hôm nay đăng loại bài gì"
//   3. Kho tài liệu      — AI tra cứu khi cần số liệu chính xác
// ============================================================

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";
const labelCls = "block text-sm font-medium text-gray-700";
const hintCls = "mt-1 text-xs text-gray-500";
const btnPrimary =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

function Alert({ state, testId }: { state: BrandState; testId?: string }) {
  if (!state || (!state.ok && !state.error)) return null;
  return (
    <div
      data-testid={testId}
      className={`rounded-lg px-3 py-2 text-sm ${
        state.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {state.error ? `✗ ${state.error}` : `✓ ${state.message}`}
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
  rows,
  testId,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  hint?: string;
  rows?: number;
  testId?: string;
}) {
  return (
    <div>
      <label className={labelCls} htmlFor={`brand-${name}`}>
        {label}
      </label>
      {rows ? (
        <textarea
          id={`brand-${name}`}
          name={name}
          rows={rows}
          data-testid={testId}
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          className={`${inputCls} mt-1`}
        />
      ) : (
        <input
          id={`brand-${name}`}
          name={name}
          data-testid={testId}
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          className={`${inputCls} mt-1`}
        />
      )}
      {hint ? <p className={hintCls}>{hint}</p> : null}
    </div>
  );
}

export type BrandProfileData = {
  brandName: string | null;
  tagline: string | null;
  description: string | null;
  industry: string | null;
  products: string | null;
  usp: string | null;
  priceRange: string | null;
  audience: string | null;
  serviceAreas: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  tone: string;
  avoidTopics: string | null;
  signatureCta: string | null;
  baseHashtags: string | null;
  samplePosts: string | null;
  notes: string | null;
} | null;

export type PillarData = {
  id: string;
  name: string;
  description: string | null;
  goal: string;
  weight: number;
  enabled: boolean;
};

export type DocData = {
  id: string;
  title: string;
  kind: string;
  content: string;
  enabled: boolean;
  length: number;
};

// ============================================================
// 1. Thông tin cơ bản
// ============================================================

function ProfileForm({ brandId, profile }: { brandId: string; profile: BrandProfileData }) {
  const [state, action, pending] = useActionState(saveBrandProfile, null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  // Đánh dấu đã hỏi cho lượt state hiện tại — tránh hỏi lặp khi React render lại
  // mà `state` không đổi.
  const askedRef = useRef<BrandState>(null);

  /**
   * Lưu hồ sơ có thể XOÁ MẤT thông tin doanh nghiệp tối thiểu (xoá trắng phần
   * giới thiệu hoặc sản phẩm) → AutoPilot hết dữ liệu để viết bài.
   *
   * Vì form này dùng `useActionState`, cờ xác nhận đi qua ô hidden
   * `confirmAutoPilotOff`: server trả yêu cầu xác nhận, ở đây hỏi người dùng rồi
   * gửi lại form kèm cờ "1".
   *
   * Lưu ý: hồ sơ VỐN ĐÃ thiếu sẵn thì không bị chặn — người dùng đang bổ sung
   * dở dang, và đó chính là cách sửa. Chỉ chặn khi lần lưu này làm mất thông tin.
   *
   * Xem khối giải thích ở src/lib/brand-scope.ts.
   */
  useEffect(() => {
    if (!state?.needsAutoPilotConfirmation) {
      // Lượt lưu đã xong (hoặc chưa từng bị chặn) → hạ cờ xuống, nếu không nó
      // dính lại "1" và lần lưu sau sẽ tắt AutoPilot mà KHÔNG hỏi.
      if (confirmRef.current) confirmRef.current.value = "0";
      return;
    }
    if (askedRef.current === state) return;
    askedRef.current = state;

    if (
      confirm(
        autoPilotConfirmPrompt(
          "Xoá thông tin doanh nghiệp khỏi hồ sơ",
          state.affectedPages ?? []
        )
      )
    ) {
      if (confirmRef.current) confirmRef.current.value = "1";
      formRef.current?.requestSubmit();
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-5">
      <input type="hidden" name="brandId" value={brandId} />
      {/* Cờ xác nhận tắt tự động đăng — chỉ đặt "1" sau khi người dùng đồng ý. */}
      <input ref={confirmRef} type="hidden" name="confirmAutoPilotOff" defaultValue="0" />

      <Alert state={state} testId="brand-profile-alert" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Tên thương hiệu"
          name="brandName"
          testId="brand-brandName"
          defaultValue={profile?.brandName}
          placeholder="Rèm Cửa Giá Rẻ Bình Dương"
          hint="Để trống sẽ dùng tên Page."
        />
        <Field
          label="Câu định vị (slogan)"
          name="tagline"
          defaultValue={profile?.tagline}
          placeholder="Rèm đẹp — giá thật — bảo hành dài"
        />
      </div>

      <Field
        label="Ngành hàng"
        name="industry"
        testId="brand-industry"
        defaultValue={profile?.industry}
        placeholder="Nội thất — rèm cửa, rèm văn phòng"
      />

      <Field
        label="Giới thiệu doanh nghiệp"
        name="description"
        testId="brand-description"
        rows={3}
        defaultValue={profile?.description}
        placeholder="Cửa hàng chuyên rèm cửa tại Bình Dương, nhận đo đạc và lắp đặt tận nơi…"
        hint="Vài câu để AI hiểu bạn là ai. Đây là phần AI đọc nhiều nhất."
      />

      <Field
        label="Sản phẩm / dịch vụ chính"
        name="products"
        testId="brand-products"
        rows={4}
        defaultValue={profile?.products}
        placeholder={"Rèm vải một màu\nRèm cầu vồng\nRèm cuốn chống nắng\nDịch vụ đo và lắp tận nơi"}
        hint="Mỗi dòng một mục. AI sẽ xoay vòng giới thiệu các mục này."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Khách hàng mục tiêu"
          name="audience"
          testId="brand-audience"
          rows={2}
          defaultValue={profile?.audience}
          placeholder="Chủ nhà 28–50 tuổi ở Bình Dương, quan tâm giá hợp lý"
        />
        <Field
          label="Điểm khác biệt so với đối thủ"
          name="usp"
          rows={2}
          defaultValue={profile?.usp}
          placeholder="Đo miễn phí, lắp trong ngày, bảo hành 2 năm"
        />
      </div>

      <Field
        label="Địa bàn hoạt động (không bắt buộc)"
        name="serviceAreas"
        testId="brand-serviceAreas"
        rows={4}
        defaultValue={profile?.serviceAreas}
        placeholder={"Bình Dương\nThủ Dầu Một\nDĩ An\nThuận An"}
        hint="Mỗi dòng một khu vực bạn phục vụ. Chế độ tự động sẽ XOAY VÒNG mỗi bài nhắm một khu vực để phủ từ khoá địa phương. AI chỉ nhắc đúng những tên bạn nhập ở đây — không tự bịa thêm. Để trống thì AI sẽ không nhắc địa bàn."
      />

      <Field
        label="Khoảng giá"
        name="priceRange"
        testId="brand-priceRange"
        defaultValue={profile?.priceRange}
        placeholder="150.000 – 450.000đ/m²"
        hint="⚠️ Quan trọng: AI chỉ được nhắc giá trong khoảng này. Để trống thì AI sẽ KHÔNG nói về giá."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Địa chỉ" name="address" defaultValue={profile?.address} />
        <Field label="Điện thoại" name="phone" defaultValue={profile?.phone} />
        <Field label="Website" name="website" defaultValue={profile?.website} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="brand-tone">
            Giọng điệu mặc định
          </label>
          <select
            id="brand-tone"
            name="tone"
            data-testid="brand-tone"
            defaultValue={profile?.tone ?? "friendly"}
            className={`${inputCls} mt-1`}
          >
            {TONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.hint}
              </option>
            ))}
          </select>
        </div>
        <Field
          label="Hashtag luôn dùng"
          name="baseHashtags"
          defaultValue={profile?.baseHashtags}
          placeholder="#remcua #binhduong"
          hint="Sẽ được gộp vào mọi bài tự động."
        />
      </div>

      <Field
        label="Câu kêu gọi hành động quen thuộc"
        name="signatureCta"
        defaultValue={profile?.signatureCta}
        placeholder="Inbox ngay để được tư vấn và báo giá miễn phí!"
      />

      <Field
        label="⛔ Tuyệt đối không nhắc tới"
        name="avoidTopics"
        testId="brand-avoidTopics"
        rows={2}
        defaultValue={profile?.avoidTopics}
        placeholder="Chính trị, tôn giáo, so sánh trực tiếp với đối thủ, cam kết rẻ nhất thị trường"
        hint="AI sẽ tránh hoàn toàn những chủ đề này."
      />

      <Field
        label="Bài viết mẫu"
        name="samplePosts"
        rows={5}
        defaultValue={profile?.samplePosts}
        placeholder="Dán 1–2 bài bạn từng đăng và thấy ưng ý…"
        hint="AI bắt chước văn phong chứ không sao chép nội dung."
      />

      <Field
        label="Ghi chú thêm cho AI"
        name="notes"
        rows={2}
        defaultValue={profile?.notes}
        placeholder="Luôn xưng 'shop', gọi khách là 'anh/chị'…"
      />

      <button type="submit" className={btnPrimary} disabled={pending} data-testid="brand-save">
        {pending ? "Đang lưu…" : "Lưu hồ sơ thương hiệu"}
      </button>
    </form>
  );
}

// ============================================================
// 2. Trụ cột nội dung
// ============================================================

function PillarSection({ brandId, pillars }: { brandId: string; pillars: PillarData[] }) {
  const [state, action, pending] = useActionState(savePillar, null);
  const [editing, setEditing] = useState<PillarData | null>(null);
  const [busy, setBusy] = useState(false);
  const [guardError, setGuardError] = useState<string | null>(null);

  /**
   * Chạy một thao tác có thể làm Brand hết trụ cột đang bật (xoá hoặc tắt trụ
   * cột cuối cùng). Server trả `needsAutoPilotConfirmation` kèm tên Page đang
   * bật tự động đăng; ở đây hỏi lại rồi gọi lần hai kèm cờ xác nhận.
   *
   * Xem khối giải thích ở src/lib/brand-scope.ts.
   */
  const runGuarded = async (
    verb: string,
    exec: (confirmAutoPilotOff: boolean) => Promise<BrandState>
  ) => {
    setGuardError(null);

    // Annotate kiểu: nhánh catch không có các trường tuỳ chọn của BrandState.
    const first: BrandState = await exec(false).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (first?.ok) return;

    if (first?.needsAutoPilotConfirmation) {
      if (confirm(autoPilotConfirmPrompt(verb, first.affectedPages ?? []))) {
        const second: BrandState = await exec(true).catch((err) => ({
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        }));
        if (second && !second.ok) {
          setGuardError(second.error ?? "Không thực hiện được thao tác.");
        }
      }
      return;
    }

    setGuardError(first?.error ?? "Không thực hiện được thao tác.");
  };

  const totalWeight = pillars.filter((p) => p.enabled).reduce((sum, p) => sum + p.weight, 0);
  const share = (w: number) => (totalWeight > 0 ? Math.round((w / totalWeight) * 100) : 0);

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <p className="font-medium">Trụ cột nội dung quyết định &ldquo;hôm nay đăng loại bài gì&rdquo;.</p>
        <p className="mt-1 text-xs">
          Hệ thống xoay vòng theo tỉ trọng bạn đặt, và không bao giờ đăng 2 bài cùng loại
          liên tiếp — nhờ vậy Page không bị nhàm chán.
        </p>
      </div>

      <Alert state={state} testId="pillar-alert" />

      {guardError ? (
        <div
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          data-testid="pillar-guard-error"
        >
          ✗ {guardError}
        </div>
      ) : null}

      {pillars.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-gray-300 p-6 text-center"
          data-testid="pillar-empty"
        >
          <p className="text-sm text-gray-600">Chưa có trụ cột nội dung nào.</p>
          <button
            type="button"
            data-testid="pillar-seed"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await createDefaultPillars(brandId);
              setBusy(false);
            }}
            className={`${btnPrimary} mt-3`}
          >
            {busy ? "Đang tạo…" : "✨ Tạo bộ 4 trụ cột mặc định"}
          </button>
          <p className={hintCls}>Tạo xong bạn sửa lại cho hợp với ngành của mình.</p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="pillar-list">
          {pillars.map((p) => (
            <li
              key={p.id}
              data-testid="pillar-item"
              data-enabled={p.enabled ? "1" : "0"}
              className={`rounded-lg border p-3 ${
                p.enabled ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50 opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{p.name}</span>
                    <span
                      className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                      data-testid="pillar-share"
                    >
                      {p.enabled ? `${share(p.weight)}% số bài` : "đang tắt"}
                    </span>
                    <span className="text-xs text-gray-500">
                      {GOALS.find((g) => g.value === p.goal)?.label ?? p.goal}
                    </span>
                  </div>
                  {p.description ? (
                    <p className="mt-1 text-xs text-gray-600">{p.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" className={btnGhost} onClick={() => setEditing(p)}>
                    Sửa
                  </button>
                  <button
                    type="button"
                    className={btnGhost}
                    data-testid="pillar-toggle"
                    onClick={() =>
                      runGuarded(`Tắt trụ cột "${p.name}"`, (confirm) =>
                        togglePillar(p.id, !p.enabled, confirm)
                      )
                    }
                  >
                    {p.enabled ? "Tắt" : "Bật"}
                  </button>
                  <button
                    type="button"
                    className={`${btnGhost} text-red-600`}
                    data-testid="pillar-delete"
                    onClick={() =>
                      runGuarded(`Xoá trụ cột "${p.name}"`, (confirm) =>
                        deletePillar(p.id, confirm)
                      )
                    }
                  >
                    Xóa
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="space-y-3 rounded-lg border border-gray-200 p-4">
        <input type="hidden" name="brandId" value={brandId} />
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        <input type="hidden" name="enabled" value={editing ? (editing.enabled ? "1" : "0") : "1"} />

        <p className="text-sm font-medium text-gray-900">
          {editing ? `Sửa trụ cột: ${editing.name}` : "Thêm trụ cột mới"}
        </p>

        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <input
            name="name"
            required
            data-testid="pillar-name"
            defaultValue={editing?.name ?? ""}
            placeholder="Tên trụ cột, ví dụ: Mẹo bảo quản"
            className={inputCls}
            key={`name-${editing?.id ?? "new"}`}
          />
          <select
            name="goal"
            defaultValue={editing?.goal ?? "engagement"}
            className={inputCls}
            key={`goal-${editing?.id ?? "new"}`}
          >
            {GOALS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <input
            name="weight"
            type="number"
            min={1}
            max={100}
            data-testid="pillar-weight"
            defaultValue={editing?.weight ?? 25}
            placeholder="Tỉ trọng"
            className={inputCls}
            key={`weight-${editing?.id ?? "new"}`}
          />
        </div>

        <textarea
          name="description"
          rows={2}
          defaultValue={editing?.description ?? ""}
          placeholder="Hướng dẫn AI cách viết loại bài này…"
          className={inputCls}
          key={`desc-${editing?.id ?? "new"}`}
        />

        <div className="flex gap-2">
          <button type="submit" className={btnPrimary} disabled={pending} data-testid="pillar-save">
            {pending ? "Đang lưu…" : editing ? "Cập nhật" : "Thêm trụ cột"}
          </button>
          {editing ? (
            <button type="button" className={btnGhost} onClick={() => setEditing(null)}>
              Hủy sửa
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

// ============================================================
// 3. Kho tài liệu
// ============================================================

const DOC_KINDS = ["PRODUCT", "PRICE", "FAQ", "POLICY", "STORY", "OTHER"];

function DocSection({ brandId, docs }: { brandId: string; docs: DocData[] }) {
  const [state, action, pending] = useActionState(saveKnowledgeDoc, null);
  const [editing, setEditing] = useState<DocData | null>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-medium">Kho tài liệu là nơi AI tra cứu thông tin chính xác.</p>
        <p className="mt-1 text-xs">
          Dán bảng giá, câu hỏi thường gặp, chính sách bảo hành… AI chỉ dùng số liệu có trong
          đây, không tự bịa. Mỗi lần viết bài, hệ thống tự chọn tối đa 4 tài liệu liên quan nhất.
        </p>
      </div>

      <Alert state={state} testId="doc-alert" />

      {docs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          Chưa có tài liệu nào. Thêm bảng giá hoặc câu hỏi thường gặp để bài viết chính xác hơn.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="doc-list">
          {docs.map((d) => (
            <li
              key={d.id}
              data-testid="doc-item"
              className={`rounded-lg border border-gray-200 p-3 ${d.enabled ? "bg-white" : "bg-gray-50 opacity-70"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{d.title}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {docKindLabel(d.kind)}
                    </span>
                    <span className="text-xs text-gray-400">{d.length} ký tự</span>
                    {!d.enabled ? (
                      <span className="text-xs text-gray-500">đang tắt</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" className={btnGhost} onClick={() => setEditing(d)}>
                    Sửa
                  </button>
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => toggleKnowledgeDoc(d.id, !d.enabled)}
                  >
                    {d.enabled ? "Tắt" : "Bật"}
                  </button>
                  <button
                    type="button"
                    className={`${btnGhost} text-red-600`}
                    onClick={() => {
                      if (confirm(`Xóa tài liệu "${d.title}"?`)) deleteKnowledgeDoc(d.id);
                    }}
                  >
                    Xóa
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="space-y-3 rounded-lg border border-gray-200 p-4">
        <input type="hidden" name="brandId" value={brandId} />
        <input type="hidden" name="id" value={editing?.id ?? ""} />
        <input type="hidden" name="enabled" value={editing ? (editing.enabled ? "1" : "0") : "1"} />

        <p className="text-sm font-medium text-gray-900">
          {editing ? `Sửa tài liệu: ${editing.title}` : "Thêm tài liệu"}
        </p>

        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <input
            name="title"
            required
            data-testid="doc-title"
            defaultValue={editing?.title ?? ""}
            placeholder="Tiêu đề, ví dụ: Bảng giá rèm 2026"
            className={inputCls}
            key={`t-${editing?.id ?? "new"}`}
          />
          <select
            name="kind"
            data-testid="doc-kind"
            defaultValue={editing?.kind ?? "OTHER"}
            className={inputCls}
            key={`k-${editing?.id ?? "new"}`}
          >
            {DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {docKindLabel(k)}
              </option>
            ))}
          </select>
        </div>

        <textarea
          name="content"
          required
          rows={6}
          data-testid="doc-content"
          defaultValue={editing?.content ?? ""}
          placeholder={"Rèm vải một màu: 180.000đ/m²\nRèm cầu vồng: 320.000đ/m²\nPhí lắp đặt: miễn phí trong Bình Dương"}
          className={inputCls}
          key={`c-${editing?.id ?? "new"}`}
        />

        <div className="flex gap-2">
          <button type="submit" className={btnPrimary} disabled={pending} data-testid="doc-save">
            {pending ? "Đang lưu…" : editing ? "Cập nhật" : "Thêm tài liệu"}
          </button>
          {editing ? (
            <button type="button" className={btnGhost} onClick={() => setEditing(null)}>
              Hủy sửa
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

// ============================================================
// Vỏ ngoài: chuyển tab
// ============================================================

const TABS = [
  { id: "profile", label: "1. Thông tin cơ bản" },
  { id: "pillars", label: "2. Trụ cột nội dung" },
  { id: "docs", label: "3. Kho tài liệu" },
] as const;

export default function BrandEditor({
  brandId,
  profile,
  pillars,
  docs,
}: {
  brandId: string;
  profile: BrandProfileData;
  pillars: PillarData[];
  docs: DocData[];
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("profile");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`brand-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t.label}
            {t.id === "pillars" && pillars.length > 0 ? (
              <span className="ml-1 text-xs text-gray-400">({pillars.length})</span>
            ) : null}
            {t.id === "docs" && docs.length > 0 ? (
              <span className="ml-1 text-xs text-gray-400">({docs.length})</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        {tab === "profile" ? <ProfileForm brandId={brandId} profile={profile} /> : null}
        {tab === "pillars" ? <PillarSection brandId={brandId} pillars={pillars} /> : null}
        {tab === "docs" ? <DocSection brandId={brandId} docs={docs} /> : null}
      </div>
    </div>
  );
}
