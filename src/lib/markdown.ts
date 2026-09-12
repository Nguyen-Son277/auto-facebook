// ============================================================
// Markdown renderer TỰ VIẾT — an toàn, không dependency.
//
// Nguyên tắc an toàn: escape TOÀN BỘ HTML trước khi chuyển markdown.
// Nhờ đó mọi ký tự < > & " do người dùng nhập đều hiển thị nguyên văn,
// không thể tiêm script. Link chỉ nhận http/https và link nội bộ "/".
//
// Hỗ trợ: # ## ### tiêu đề, **đậm**, *nghiêng*, `code`,
// ``` khối code, - danh sách, 1. danh sách đánh số, [text](url),
// | bảng |, --- đường kẻ ngang, đoạn văn + xuống dòng.
// Ảnh (![...]) cố tình KHÔNG hỗ trợ — docs hiện tại chỉ dùng chữ.
// ============================================================

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ESCAPE[ch]);
}

/** Link an toàn: http(s) hoặc nội bộ bắt đầu bằng "/" */
function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\/[^\s]+$/i.test(u)) return u;
  if (/^\/[^\s]*$/.test(u)) return u;
  return null;
}

/** Inline: đậm/nghiêng/code/link — đầu vào đã escape HTML. */
function renderInline(text: string): string {
  let out = escapeHtml(text);
  // code trước để nội dung `...` không bị xử lý tiếp
  out = out.replace(/`([^`]+)`/g, '<code class="rounded bg-gray-100 px-1 py-0.5 text-[0.9em] text-gray-800">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label: string, href: string) => {
      const safe = safeHref(href);
      if (!safe) return label;
      const external = safe.startsWith("http");
      return `<a href="${safe}" class="font-medium text-blue-600 hover:underline"${
        external ? ' target="_blank" rel="noopener noreferrer"' : ""
      }>${label}</a>`;
    }
  );
  return out;
}

/**
 * Chuyển markdown sang HTML. Trả về chuỗi render bằng
 * dangerouslySetInnerHTML ở nơi gọi — đầu ra đã escape nên an toàn.
 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let para: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const closePara = () => {
    if (para.length) {
      html.push(`<p class="leading-relaxed">${para.join("<br/>")}</p>`);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // ----- khối code ----- 
    if (raw.trim().startsWith("```")) {
      if (inCodeBlock) {
        html.push(
          `<pre class="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100"><code>${escapeHtml(
            codeLines.join("\n")
          )}</code></pre>`
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        closePara();
        closeList();
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(raw);
      continue;
    }

    // ----- bảng | cột | cột | -----
    // Nhận diện: dòng hiện tại là hàng tiêu đề, dòng kế tiếp là dòng phân cách
    // (|---|---|). Sau đó gom mọi dòng còn lại cũng có dạng |...|.
    const tblLine = raw.trim();
    if (/^\|.*\|$/.test(tblLine) && i + 1 < lines.length) {
      const sep = lines[i + 1].trim();
      if (/^\|[\s:|-]+\|$/.test(sep) && sep.includes("-")) {
        closePara();
        closeList();
        const splitRow = (row: string) =>
          row
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim());

        const head = splitRow(tblLine);
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && /^\|.*\|$/.test(lines[j].trim())) {
          rows.push(splitRow(lines[j].trim()));
          j++;
        }

        html.push(
          '<div class="my-3 overflow-x-auto rounded-lg border border-gray-200">' +
            '<table class="w-full border-collapse text-sm">'
        );
        html.push('<thead><tr class="bg-gray-50">');
        for (const c of head) {
          html.push(
            `<th class="border-b border-gray-200 px-3 py-2 text-left font-semibold text-gray-900">${renderInline(
              c
            )}</th>`
          );
        }
        html.push("</tr></thead><tbody>");
        for (const r of rows) {
          html.push('<tr class="border-b border-gray-100 last:border-0">');
          for (let k = 0; k < head.length; k++) {
            html.push(
              `<td class="px-3 py-2 align-top text-gray-700">${renderInline(r[k] ?? "")}</td>`
            );
          }
          html.push("</tr>");
        }
        html.push("</tbody></table></div>");
        i = j - 1;
        continue;
      }
    }

    const line = raw.trimEnd();

    if (!line.trim()) {
      closePara();
      closeList();
      continue;
    }

    // đường kẻ ngang
    if (/^-{3,}$/.test(line.trim())) {
      closePara();
      closeList();
      html.push('<hr class="my-4 border-gray-200"/>');
      continue;
    }

    // tiêu đề
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closePara();
      closeList();
      const level = heading[1].length;
      const cls =
        level === 1
          ? "mt-5 mb-2 text-xl font-bold text-gray-900"
          : level === 2
            ? "mt-5 mb-2 text-lg font-semibold text-gray-900"
            : "mt-4 mb-1.5 text-base font-semibold text-gray-800";
      html.push(`<h${level + 1} class="${cls}">${renderInline(heading[2])}</h${level + 1}>`);
      continue;
    }

    // danh sách gạch đầu dòng
    const ul = /^[-*]\s+(.*)$/.exec(line.trim());
    if (ul) {
      closePara();
      if (listType !== "ul") {
        closeList();
        listType = "ul";
        html.push('<ul class="my-2 list-disc space-y-1 pl-6">');
      }
      html.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }

    // danh sách đánh số
    const ol = /^\d+[.)]\s+(.*)$/.exec(line.trim());
    if (ol) {
      closePara();
      if (listType !== "ol") {
        closeList();
        listType = "ol";
        html.push('<ol class="my-2 list-decimal space-y-1 pl-6">');
      }
      html.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }

    closeList();
    para.push(renderInline(line.trim()));
  }

  // đóng khối code dang dở (thiếu ```) — cứ xuất nốt
  if (inCodeBlock) {
    html.push(
      `<pre class="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100"><code>${escapeHtml(
        codeLines.join("\n")
      )}</code></pre>`
    );
  }
  closePara();
  closeList();

  return html.join("\n");
}

/** Dòng văn bản đầu tiên (bỏ markdown) — dùng làm mô tả ngắn trong danh sách. */
export function firstLine(md: string): string {
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("```") || line.startsWith("---")) continue;
    return line
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .slice(0, 160);
  }
  return "";
}

/** Sinh slug từ tiêu đề tiếng Việt: bỏ dấu, thay khoảng trắng, suffix ngắn. */
export function slugify(title: string, suffix?: string): string {
  const base =
    title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "doc";
  return suffix ? `${base}-${suffix}` : base;
}
