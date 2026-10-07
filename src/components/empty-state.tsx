import Link from "next/link";

// ============================================================
// Trạng thái rỗng dùng chung — thay cho hộp nét đứt đơn điệu.
//
// Một cấu trúc thống nhất khắp app: icon trong ô màu · tiêu đề ·
// giải thích ngắn · nút hành động trực tiếp, nên người dùng luôn
// biết phải làm gì tiếp theo.
// ============================================================

export default function EmptyState({
  icon = "📭",
  title,
  description,
  testId,
  action,
  actionHref,
  actionLabel,
  children,
}: {
  icon?: string;
  title: string;
  description?: React.ReactNode;
  /** Gắn data-testid để giữ selector của test E2E hiện có. */
  testId?: string;
  actionHref?: string;
  actionLabel?: string;
  /** Render thay cho actionHref/actionLabel khi cần nút tùy biến. */
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const cta =
    action ??
    (actionHref && actionLabel ? (
      <Link href={actionHref} className="ui-btn ui-btn-primary">
        {actionLabel}
      </Link>
    ) : null);

  return (
    <div className="ui-card p-8 text-center sm:p-10" data-testid={testId}>
      <div className="ui-tile ui-tile-lg ui-tile-slate mx-auto" aria-hidden>
        {icon}
      </div>
      <p className="mt-4 text-base font-semibold text-gray-900">{title}</p>
      {description && (
        <div className="mx-auto mt-1.5 max-w-xl text-sm leading-relaxed text-gray-500">
          {description}
        </div>
      )}
      {cta && <div className="mt-4 flex flex-wrap justify-center gap-2">{cta}</div>}
      {children}
    </div>
  );
}
