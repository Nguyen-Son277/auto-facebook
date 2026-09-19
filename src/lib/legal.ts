/**
 * NỘI DUNG PHÁP LÝ + THÔNG TIN CÔNG KHAI
 * =====================================
 * Một chỗ duy nhất để sửa: đổi tên đơn vị, email hỗ trợ, ngày hiệu lực...
 * là cả trang chủ, trang chính sách bảo mật và trang điều khoản cùng cập nhật.
 *
 * QUY ƯỚC SOẠN NỘI DUNG (đọc bởi components/inline-rich-text.tsx):
 *   **đậm**            → chữ đậm
 *   [nhãn](https://…)  → liên kết, tự mở tab mới
 *
 * Các chỗ còn thiếu thông tin thật được đánh dấu [ĐIỀN …] — tìm và thay
 * trước khi công bố hoặc gửi Meta App Review.
 */

export const APP_NAME = "FB Marketing Auto";

export const LEGAL = {
  /** Ngày hai trang pháp lý có hiệu lực (dd/mm/yyyy). */
  effectiveDate: "19/09/2026",
  /** Email tiếp nhận yêu cầu về dữ liệu / hỗ trợ người dùng. */
  supportEmail: "thehung020630@gmail.com",
  /** Đơn vị vận hành — ĐIỀN TÊN THẬT trước khi công bố. */
  companyName: "[ĐIỀN TÊN CÔNG TY / CÁ NHÂN VẬN HÀNH]",
  /** Địa chỉ liên hệ — ĐIỀN THẬT trước khi công bố. */
  address: "[ĐIỀN ĐỊA CHỈ LIÊN HỆ]",
  /** Nơi áp dụng cho tranh chấp (điều khoản dịch vụ). */
  governingLaw: "[ĐIỀN TỈNH/THÀNH NƠI ĐƠN VỊ ĐĂNG KÝ]",
  /** Thời hạn xoá dữ liệu sau khi người dùng yêu cầu (ngày). */
  deletionDays: 30,
} as const;

export type LegalSection = {
  heading: string;
  /** Đoạn văn xuôi. */
  paragraphs?: string[];
  /** Danh sách gạch đầu dòng. */
  bullets?: string[];
};

export type LegalDocument = {
  slug: string;
  title: string;
  /** Dùng cho thẻ <title>/meta description. */
  description: string;
  intro: string;
  sections: LegalSection[];
};

const { supportEmail, companyName, address, deletionDays } = LEGAL;

// ============================================================
// CHÍNH SÁCH BẢO MẬT
// ============================================================

export const PRIVACY_POLICY: LegalDocument = {
  slug: "/chinh-sach-bao-mat",
  title: "Chính sách bảo mật",
  description:
    "Cách FB Marketing Auto thu thập, sử dụng, lưu trữ và xoá dữ liệu người dùng cũng như dữ liệu từ Facebook Page.",
  intro:
    `${APP_NAME} là công cụ hỗ trợ doanh nghiệp tự động soạn nội dung bằng AI và đăng bài lên Facebook Page mà họ quản lý. ` +
    `Chính sách này giải thích chúng tôi thu thập dữ liệu gì, dùng để làm gì, lưu trong bao lâu và bạn kiểm soát dữ liệu của mình ra sao. ` +
    `Khi tạo tài khoản và dùng dịch vụ, bạn đồng ý với cách xử lý dữ liệu được mô tả ở đây.`,
  sections: [
    {
      heading: "1. Dữ liệu chúng tôi thu thập",
      paragraphs: [
        "Chúng tôi chỉ thu thập dữ liệu cần thiết để vận hành dịch vụ:",
      ],
      bullets: [
        "**Thông tin tài khoản:** email đăng nhập, tên hiển thị, mật khẩu đã băm bằng bcrypt (chúng tôi không lưu mật khẩu gốc), trạng thái tài khoản (chờ duyệt / đã duyệt / bị khoá) và thời điểm thay đổi mật khẩu.",
        "**Dữ liệu Facebook:** mã ứng dụng (App ID), App Secret, User Access Token và danh sách Facebook Page (tên Page, Page ID, ảnh đại diện) mà bạn cấp quyền cho ứng dụng. Các giá trị bí mật được **mã hoá AES-256-GCM** trước khi lưu.",
        "**Google Drive (tuỳ chọn):** email Google đã cấp quyền, quyền truy cập đã cấp và refresh token (đã mã hoá) nếu bạn nối Drive làm nguồn ảnh/video.",
        "**Dữ liệu nghiệp vụ:** nội dung bài viết, trạng thái đăng, lịch hẹn và múi giờ, hồ sơ thương hiệu, trụ cột nội dung, kho tài liệu bạn tự tải lên.",
        "**Media:** ảnh/video bạn tải lên, chọn từ Pexels hoặc chọn từ Google Drive của bạn (kèm thông tin tác giả mà Pexels yêu cầu ghi công).",
        "**Cấu hình cá nhân:** API key của nhà cung cấp AI và Pexels (đã mã hoá) cùng các tuỳ chọn như giao diện sáng/tối.",
        "**Dữ liệu kỹ thuật:** thời điểm thao tác, nhật ký lỗi (ví dụ token Facebook hết hạn) và số lượng thông báo chưa đọc — phục vụ vận hành và hỗ trợ.",
      ],
    },
    {
      heading: "2. Dữ liệu Facebook được dùng như thế nào",
      bullets: [
        "Chỉ dùng để **hiển thị danh sách Page bạn quản lý**, đăng bài thay bạn theo đúng lịch bạn đặt và hiển thị trạng thái bài đăng (thành công / thất bại).",
        "Ứng dụng **không truy cập** tin nhắn Messenger, danh sách bạn bè, bài viết của người khác hay thông tin cá nhân ngoài phạm vi Page bạn đã cấp quyền.",
        "Không có hoạt động đăng bài nào diễn ra tự động khi bạn chưa bật tính năng và chưa cấu hình lịch.",
        "Tuân thủ Điều khoản nền tảng và Chính sách dành cho nhà phát triển của Meta; việc dùng dữ liệu Facebook cho mục đích khác là không được phép.",
      ],
    },
    {
      heading: "3. Chia sẻ dữ liệu cho bên thứ ba",
      paragraphs: [
        "Chúng tôi **không bán** dữ liệu người dùng và không chia sẻ cho mục đích quảng cáo. Dữ liệu chỉ được gửi tới các dịch vụ hạ tầng cần thiết để chạy ứng dụng:",
      ],
      bullets: [
        "**Facebook Graph API (Meta)** — khi bạn lấy danh sách Page hoặc đăng bài lên Page của mình.",
        "**Nhà cung cấp AI** — khi bạn chủ động viết hoặc lên lịch bài, nội dung thương hiệu và yêu cầu của bạn được gửi tới mô hình AI để sinh nội dung.",
        "**Pexels** — khi bạn tìm ảnh/video stock theo từ khoá.",
        "**Google Drive** — khi bạn nối Drive và chọn thư mục làm nguồn media (quyền `drive.file`, chỉ thấy file do ứng dụng tạo hoặc do bạn chọn).",
        "**Supabase** — nơi đặt cơ sở dữ liệu và lưu trữ file tải lên.",
        "**Nhà cung cấp hạ tầng khác (máy chủ, email thông báo)** — chỉ nhằm vận hành dịch vụ.",
        "Khi có yêu cầu hợp pháp từ cơ quan nhà nước có thẩm quyền, chúng tôi có thể phải cung cấp dữ liệu theo quy định pháp luật.",
      ],
    },
    {
      heading: "4. Lưu trữ và bảo mật",
      bullets: [
        "Mật khẩu được băm bằng bcrypt và không thể khôi phục về dạng gốc.",
        "App Secret, access token Facebook, API key AI/Pexels và refresh token Google Drive được mã hoá AES-256-GCM; chỉ tiến trình máy chủ giải mã khi cần gọi dịch vụ và không bao giờ trả về trình duyệt.",
        "Kết nối giữa trình duyệt, máy chủ và các bên thứ ba đều dùng HTTPS; phiên đăng nhập là cookie `httpOnly` + `sameSite=lax`.",
        "Ứng dụng **không lưu mật khẩu Facebook** của bạn ở bất kỳ dạng nào.",
        "Chúng tôi giới hạn quyền truy cập dữ liệu cho những tài khoản thực sự cần để vận hành và hỗ trợ kỹ thuật.",
      ],
    },
    {
      heading: "5. Thời gian lưu trữ",
      bullets: [
        `Dữ liệu được giữ trong thời gian tài khoản còn hoạt động. Khi bạn yêu cầu xoá, chúng tôi xử lý trong vòng **${deletionDays} ngày** (trừ dữ liệu buộc phải lưu theo quy định pháp luật).`,
        "Khi quản trị viên xoá tài khoản, dữ liệu nghiệp vụ đi kèm (bài viết, media, thương hiệu, kết nối Facebook/Drive) bị xoá theo.",
        "Bạn có thể ngắt kết nối Facebook hoặc Google Drive bất cứ lúc nào; token tương ứng sẽ ngừng được sử dụng ngay sau đó.",
      ],
    },
    {
      heading: "6. Quyền của bạn",
      bullets: [
        "Xem và cập nhật thông tin tài khoản, hồ sơ thương hiệu và nội dung đã tạo.",
        "Yêu cầu trích xuất hoặc xoá dữ liệu cá nhân bằng cách gửi email tới " +
          `[${supportEmail}](mailto:${supportEmail}).`,
        "Ngắt kết nối Facebook/Google Drive trong phần Cài đặt của ứng dụng.",
        "Thu hồi quyền của ứng dụng trong Facebook (Cài đặt & quyền riêng tư → Cài đặt → Ứng dụng và trang web) hoặc trong tài khoản Google của bạn.",
      ],
    },
    {
      heading: "7. Cookie",
      paragraphs: [
        "Ứng dụng chỉ dùng cookie cần thiết cho hoạt động: cookie phiên đăng nhập (`httpOnly`) và ghi nhớ lựa chọn giao diện sáng/tối. " +
          "Chúng tôi không dùng cookie quảng cáo hay theo dõi bạn trên các website khác.",
      ],
    },
    {
      heading: "8. Trẻ em",
      paragraphs: [
        "Dịch vụ dành cho doanh nghiệp và người quản lý Page từ 13 tuổi trở lên theo chính sách của Meta. " +
          "Chúng tôi không cố ý thu thập dữ liệu của trẻ em; nếu phát hiện, dữ liệu đó sẽ bị xoá.",
      ],
    },
    {
      heading: "9. Thay đổi chính sách",
      paragraphs: [
        "Khi chính sách thay đổi, chúng tôi cập nhật ngày hiệu lực ở đầu trang và thông báo cho bạn với những thay đổi quan trọng. " +
          "Việc tiếp tục sử dụng dịch vụ sau khi cập nhật đồng nghĩa bạn chấp nhận nội dung mới.",
      ],
    },
    {
      heading: "10. Liên hệ",
      paragraphs: [
        `Mọi câu hỏi về quyền riêng tư và dữ liệu cá nhân, vui lòng gửi tới [${supportEmail}](mailto:${supportEmail}).`,
        `Đơn vị vận hành: ${companyName} — ${address}.`,
      ],
    },
  ],
};

// ============================================================
// ĐIỀU KHOẢN DỊCH VỤ
// ============================================================

export const TERMS_OF_SERVICE: LegalDocument = {
  slug: "/dieu-khoan-dich-vu",
  title: "Điều khoản dịch vụ",
  description:
    "Các điều khoản sử dụng dịch vụ FB Marketing Auto: quyền và nghĩa vụ của người dùng, trách nhiệm với nội dung và Facebook Page.",
  intro:
    `Điều khoản này là thoả thuận giữa bạn và ${companyName} về việc sử dụng ${APP_NAME}. ` +
    `Bằng cách tạo tài khoản hoặc dùng dịch vụ, bạn xác nhận đã đọc, hiểu và đồng ý với các điều khoản dưới đây. ` +
    `Nếu bạn dùng dịch vụ thay cho doanh nghiệp của mình, bạn cam kết có đủ thẩm quyền để chấp nhận các điều khoản này.`,
  sections: [
    {
      heading: "1. Mô tả dịch vụ",
      bullets: [
        `${APP_NAME} giúp bạn soạn nội dung bằng AI, chọn ảnh/video (Pexels, tải lên hoặc Google Drive), hẹn lịch và đăng bài lên các Facebook Page mà bạn có quyền quản lý.`,
        "Dịch vụ cần bạn tự cung cấp: Facebook App (App ID/App Secret/token), API key nhà cung cấp AI và Pexels, cùng kết nối Google Drive nếu bạn dùng nguồn media đó.",
        "Dịch vụ được cung cấp theo tình trạng hiện có. Chúng tôi có thể thêm, sửa hoặc tạm dừng một tính năng, và sẽ thông báo trước với thay đổi ảnh hưởng lớn.",
      ],
    },
    {
      heading: "2. Tài khoản và quyền truy cập",
      bullets: [
        "Tài khoản do quản trị viên của hệ thống tạo hoặc phê duyệt; đăng ký chưa được duyệt thì chưa dùng được dịch vụ.",
        "Bạn chịu trách nhiệm bảo mật thông tin đăng nhập và mọi hoạt động phát sinh từ tài khoản của mình. Phát hiện truy cập trái phép, hãy đổi mật khẩu và báo ngay cho chúng tôi.",
        "Bạn cam kết cung cấp thông tin chính xác và chỉ dùng dịch vụ cho Facebook Page mà bạn thực sự có quyền quản lý.",
        "Không được chia sẻ tài khoản, dò quét, khai thác lỗ hổng hay can thiệp vào hoạt động của hệ thống.",
      ],
    },
    {
      heading: "3. Nội dung và trách nhiệm đăng bài",
      bullets: [
        "**Bạn là người chịu trách nhiệm cuối cùng** về mọi nội dung được đăng lên Page của mình, kể cả nội dung do AI sinh ra. Hãy kiểm tra lại trước khi đăng hoặc trước khi bật chế độ tự động.",
        "Nội dung phải tuân thủ Tiêu chuẩn cộng đồng và Điều khoản nền tảng của Meta, cũng như pháp luật Việt Nam.",
        "Nghiêm cấm dùng dịch vụ để đăng nội dung sai lệch gây hiểu nhầm, quấy rối, thù địch, khiêu dâm, bạo lực, vi phạm bản quyền, spam hoặc mua bán hàng hoá bị pháp luật cấm.",
        "Nghiêm cấm dùng dịch vụ để thao túng, gian lận, phát tán mã độc hoặc tác động đến Page không thuộc quyền quản lý của bạn.",
        "Chúng tôi có thể tạm khoá tài khoản đang có dấu hiệu vi phạm để bảo vệ hệ thống và người dùng khác.",
      ],
    },
    {
      heading: "4. Quyền sở hữu trí tuệ",
      bullets: [
        "Bạn giữ toàn bộ quyền với nội dung, hình ảnh, video và tài liệu bạn tải lên. Bạn cấp cho chúng tôi quyền xử lý và truyền những dữ liệu này tới Facebook cùng các dịch vụ liên quan **chỉ để thực hiện việc bạn yêu cầu**.",
        "Bạn phải có quyền hợp pháp với mọi media mình dùng. Ảnh/video từ Pexels được dùng theo giấy phép của Pexels; bạn tự chịu trách nhiệm tuân thủ giấy phép đó.",
        "Chúng tôi giữ quyền với mã nguồn, giao diện và thương hiệu của ứng dụng.",
      ],
    },
    {
      heading: "5. Dịch vụ và API của bên thứ ba",
      paragraphs: [
        "Dịch vụ phụ thuộc vào Facebook Graph API, nhà cung cấp AI, Pexels, Google Drive và hạ tầng lưu trữ. " +
          "Bạn cần có tài khoản và tuân thủ điều khoản của các bên này, đồng thời tự chi trả chi phí sử dụng API của họ (nếu có). " +
          "Thay đổi chính sách, giới hạn tần suất, lỗi hay gián đoạn từ phía họ nằm ngoài tầm kiểm soát của chúng tôi.",
      ],
    },
    {
      heading: "6. Chi phí",
      paragraphs: [
        "Các gói dịch vụ trả phí (nếu có) cùng mức giá sẽ được thông báo trước khi bạn đăng ký. " +
          "Chi phí API của bên thứ ba do bạn thanh toán trực tiếp cho nhà cung cấp đó.",
      ],
    },
    {
      heading: "7. Tạm ngừng và chấm dứt",
      bullets: [
        "Bạn có thể ngừng sử dụng dịch vụ bất cứ lúc nào; yêu cầu xoá dữ liệu được xử lý theo Chính sách bảo mật.",
        "Chúng tôi có thể tạm ngừng hoặc chấm dứt quyền truy cập nếu bạn vi phạm điều khoản, gây rủi ro cho hệ thống hoặc cho người khác.",
        "Khi chấm dứt, quyền sử dụng dịch vụ kết thúc nhưng các nghĩa vụ đã phát sinh trước đó vẫn còn hiệu lực.",
      ],
    },
    {
      heading: "8. Giới hạn trách nhiệm",
      bullets: [
        "Dịch vụ được cung cấp **\"nguyên trạng\"**, không kèm bảo đảm rằng bài đăng luôn thành công, đúng giờ hoặc không bị nền tảng từ chối, hạn chế hay xoá.",
        "Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm cho thiệt hại gián tiếp như mất doanh thu, mất uy tín hay mất dữ liệu do lỗi từ bên thứ ba, do bạn cấu hình sai hoặc do nguyên nhân bất khả kháng.",
        "Bạn tự sao lưu những nội dung quan trọng trước khi đăng.",
      ],
    },
    {
      heading: "9. Luật áp dụng và giải quyết tranh chấp",
      paragraphs: [
        `Điều khoản này được điều chỉnh bởi pháp luật Việt Nam. Hai bên ưu tiên giải quyết tranh chấp bằng thương lượng; ` +
          `nếu không đạt kết quả, tranh chấp sẽ được đưa ra cơ quan có thẩm quyền tại ${LEGAL.governingLaw}.`,
      ],
    },
    {
      heading: "10. Liên hệ",
      paragraphs: [
        `Mọi câu hỏi về điều khoản này, vui lòng gửi tới [${supportEmail}](mailto:${supportEmail}).`,
        `Đơn vị vận hành: ${companyName} — ${address}.`,
      ],
    },
  ],
};

/** Dùng cho footer và liên kết chéo giữa các trang công khai. */
export const LEGAL_LINKS = [
  { href: PRIVACY_POLICY.slug, label: "Chính sách bảo mật" },
  { href: TERMS_OF_SERVICE.slug, label: "Điều khoản dịch vụ" },
] as const;
