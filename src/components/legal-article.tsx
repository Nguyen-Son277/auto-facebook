import Link from "next/link";
import InlineRichText from "@/components/inline-rich-text";
import {
  APP_NAME,
  LEGAL,
  LEGAL_LINKS,
  type LegalDocument,
} from "@/lib/legal";

/**
 * Khung hiển thị một văn bản pháp lý (chính sách bảo mật / điều khoản dịch vụ).
 * Nội dung nằm trong lib/legal.ts — sửa ở đó, không cần đụng vào component này.
 */
export default function LegalArticle({ doc }: { doc: LegalDocument }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 md:px-6 md:py-16">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-blue-600">
          {APP_NAME}
        </p>
        <h1 className="mt-2 text-3xl font-bold text-gray-900 md:text-4xl">
          {doc.title}
        </h1>
        <p className="mt-3 text-sm text-gray-500">
          Ngày hiệu lực: {LEGAL.effectiveDate}
        </p>
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-sm leading-relaxed text-gray-600">
            <InlineRichText text={doc.intro} />
          </p>
        </div>
      </header>

      <div className="mt-10 space-y-10">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-xl font-bold text-gray-900">
              {section.heading}
            </h2>

            {section.paragraphs?.map((paragraph) => (
              <p
                key={paragraph}
                className="mt-3 text-sm leading-relaxed text-gray-600"
              >
                <InlineRichText text={paragraph} />
              </p>
            ))}

            {section.bullets && (
              <ul className="mt-3 space-y-2.5">
                {section.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="flex gap-2.5 text-sm leading-relaxed text-gray-600"
                  >
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                    <span>
                      <InlineRichText text={bullet} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <footer className="mt-12 rounded-2xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-gray-600">
          Xem thêm{" "}
          {LEGAL_LINKS.map((item, index) => (
            <span key={item.href}>
              {index > 0 && " · "}
              <Link
                href={item.href}
                className="font-medium text-blue-600 hover:underline"
              >
                {item.label}
              </Link>
            </span>
          ))}
          . Mọi câu hỏi, gửi về{" "}
          <a
            href={`mailto:${LEGAL.supportEmail}`}
            className="font-medium text-blue-600 hover:underline"
          >
            {LEGAL.supportEmail}
          </a>
          .
        </p>
      </footer>
    </article>
  );
}
