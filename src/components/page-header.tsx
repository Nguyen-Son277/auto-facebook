/**
 * Đầu trang dùng chung mọi trang dashboard.
 *
 * Cấu trúc: tiêu đề lớn + mô tả bên trái, nhóm nút hành động bên phải.
 * `mb-6` giữ khoảng cách chuẩn với phần nội dung bên dưới.
 */
export default function PageHeader({
  title,
  description,
  actions,
  kicker,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Nhãn nhỏ in hoa phía trên tiêu đề (tùy chọn). */
  kicker?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker && <p className="ui-kicker mb-1.5">{kicker}</p>}
        <h1 className="text-[1.6rem] font-bold leading-tight tracking-tight text-gray-900 md:text-[1.8rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-500">
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
