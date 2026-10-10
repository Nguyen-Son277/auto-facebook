/**
 * Đầu trang dùng chung mọi trang dashboard.
 *
 * Cấu trúc: tiêu đề lớn + mô tả bên trái, nhóm nút hành động bên phải.
 * `mb-7` giữ khoảng cách chuẩn với phần nội dung bên dưới.
 */
export default function PageHeader({
  title,
  description,
  actions,
  kicker,
  titleTestId,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Nhãn nhỏ in hoa phía trên tiêu đề (tùy chọn). */
  kicker?: string;
  /** Giữ selector của tiêu đề khi chuyển sang heading dùng chung. */
  titleTestId?: string;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <span aria-hidden className="h-1.5 w-8 rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
          {kicker && <p className="ui-kicker">{kicker}</p>}
        </div>
        <h1 data-testid={titleTestId} className="break-words text-[1.7rem] font-bold leading-tight tracking-[-0.035em] text-gray-900 md:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-500">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PlaceholderCard({
  icon,
  title,
  description,
  weekLabel,
}: {
  icon: string;
  title: string;
  description: string;
  weekLabel: string;
}) {
  return (
    <div className="ui-card p-8 text-center">
      <div className="ui-tile ui-tile-lg ui-tile-slate mx-auto" aria-hidden>
        {icon}
      </div>
      <h2 className="mt-4 text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">{description}</p>
      <span className="ui-chip mt-4 inline-flex bg-blue-50 text-blue-700">
        {weekLabel}
      </span>
    </div>
  );
}
