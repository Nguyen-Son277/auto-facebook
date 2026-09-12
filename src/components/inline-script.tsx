/**
 * Inline script chèn thẳng vào HTML, chạy đồng bộ trước lần paint đầu tiên.
 *
 * Vì sao cần file này: React 19 cảnh báo khi trong cây component có thẻ
 * `<script>` ("Encountered a script tag while rendering React component").
 * Theo hướng dẫn chính thức của Next 16
 * (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md):
 * đặt `type="text/javascript"` ở server và `type="text/plain"` ở client, kèm
 * `suppressHydrationWarning` để React bỏ qua khác biệt type.
 *
 * Script vẫn chạy bình thường khi browser parse HTML (SSR), nên không nhấp nháy
 * theme; trên client nó chỉ là dữ liệu không thực thi — đúng như mong muốn.
 */
export default function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
