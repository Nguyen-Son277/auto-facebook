import Link from "next/link";

/**
 * Hiển thị văn bản có định dạng nhẹ cho nội dung pháp lý (lib/legal.ts):
 *   **đậm**            → <strong>
 *   [nhãn](https://…)  → liên kết (mở tab mới với URL ngoài)
 *
 * Nội dung là hằng số trong mã nguồn nên không có rủi ro XSS. Với liên kết,
 * chỉ http/https và đường dẫn nội bộ bắt đầu bằng "/" mới được render —
 * scheme lạ (javascript:, data:…) bị hạ cấp thành chữ thường.
 */

const TOKEN_PATTERN = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function isSafeHref(href: string): boolean {
  return href.startsWith("/") || /^https?:\/\//i.test(href);
}

export default function InlineRichText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));

    const [, boldText, linkLabel, href] = match;
    if (boldText !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold text-gray-900">
          {boldText}
        </strong>
      );
    } else if (href && isSafeHref(href)) {
      const className =
        "font-medium text-blue-600 hover:underline break-words";
      nodes.push(
        href.startsWith("/") ? (
          <Link key={key++} href={href} className={className}>
            {linkLabel}
          </Link>
        ) : (
          <a
            key={key++}
            href={href}
            className={className}
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkLabel}
          </a>
        )
      );
    } else {
      // Liên kết không an toàn → giữ nguyên chữ, không tạo thẻ <a>
      nodes.push(match[0]);
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}
