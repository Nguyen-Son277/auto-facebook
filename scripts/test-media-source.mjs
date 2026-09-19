// ============================================================
// Kiểm thử logic THUẦN chọn nguồn media (src/lib/media-source.ts).
//
// Chạy: npm run test:media-source
//
// Không cần dev server, database hay mock: đây là hàm thuần nên test được
// mọi tổ hợp "nguồn chính + dự phòng" mà không gọi Drive/Pexels thật.
// ============================================================

import {
  AUTOPILOT_SOURCES,
  MEDIA_SOURCE_LABEL,
  fallbackNotice,
  isAutopilotSource,
  mediaCandidates,
  noSourceReason,
  sourceBlocker,
} from "../src/lib/media-source.ts";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

/** Cấu hình mặc định: nguồn chính Pexels, có dự phòng, cả hai nguồn sẵn sàng. */
function cfg(overrides = {}) {
  return {
    autoMedia: true,
    mediaPrimary: "PEXELS",
    mediaFallback: true,
    drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
    pexelsReady: true,
    // Nguồn DRIVE chạy được bằng "kho ảnh đã chọn qua Picker", không cần thư mục
    driveFileCount: 5,
    ...overrides,
  };
}

// ============================================================
section("Tắt tự tìm ảnh ⇒ không nguồn nào");
// ============================================================

check("autoMedia = false → []", mediaCandidates(cfg({ autoMedia: false })).length === 0);
check(
  "autoMedia = false → lý do rõ ràng",
  noSourceReason(cfg({ autoMedia: false })).includes("tắt tự tìm ảnh"),
  noSourceReason(cfg({ autoMedia: false }))
);

// ============================================================
section("Chỉ dùng đúng nguồn chính (mediaFallback = false)");
// ============================================================

check(
  "Chính Pexels, tắt dự phòng → chỉ Pexels",
  JSON.stringify(mediaCandidates(cfg({ mediaFallback: false }))) === '["PEXELS"]',
  JSON.stringify(mediaCandidates(cfg({ mediaFallback: false })))
);

check(
  "Chính Drive, tắt dự phòng → chỉ Drive",
  JSON.stringify(mediaCandidates(cfg({ mediaPrimary: "DRIVE", mediaFallback: false }))) === '["DRIVE"]',
  JSON.stringify(mediaCandidates(cfg({ mediaPrimary: "DRIVE", mediaFallback: false })))
);

// ============================================================
section("Kết hợp: nguồn chính + dự phòng");
// ============================================================

check(
  "Chính Drive + dự phòng bật → Drive trước, Pexels sau",
  JSON.stringify(mediaCandidates(cfg({ mediaPrimary: "DRIVE" }))) === '["DRIVE","PEXELS"]',
  JSON.stringify(mediaCandidates(cfg({ mediaPrimary: "DRIVE" })))
);

check(
  "Chính Pexels + dự phòng bật → Pexels trước, Drive sau",
  JSON.stringify(mediaCandidates(cfg())) === '["PEXELS","DRIVE"]',
  JSON.stringify(mediaCandidates(cfg()))
);

// ============================================================
section("Nguồn chính không khả dụng thì rơi sang nguồn còn lại");
// ============================================================

check(
  "Chưa nối Drive + dự phòng bật → vẫn còn Pexels",
  JSON.stringify(
    mediaCandidates(cfg({ mediaPrimary: "DRIVE", drive: null }))
  ) === '["PEXELS"]',
  JSON.stringify(mediaCandidates(cfg({ mediaPrimary: "DRIVE", drive: null })))
);

check(
  "Chưa nối Drive + tắt dự phòng → không nguồn nào",
  mediaCandidates(cfg({ mediaPrimary: "DRIVE", drive: null, mediaFallback: false })).length === 0
);

// QUAN TRỌNG: thư mục KHÔNG còn là điều kiện bắt buộc. Scope `drive.file` cấp
// quyền theo từng tài nguyên người dùng chọn, nên nguồn Drive dùng được chỉ cần
// đã chọn ảnh qua Picker (driveFileCount > 0).
check(
  "Chưa gắn thư mục NHƯNG đã chọn ảnh qua Picker → vẫn dùng được Drive",
  JSON.stringify(
    mediaCandidates(
      cfg({
        mediaPrimary: "DRIVE",
        drive: { folderId: null, connectionStatus: "ACTIVE" },
        driveFileCount: 5,
      })
    )
  ) === '["DRIVE","PEXELS"]',
  JSON.stringify(
    mediaCandidates(
      cfg({
        mediaPrimary: "DRIVE",
        drive: { folderId: null, connectionStatus: "ACTIVE" },
        driveFileCount: 5,
      })
    )
  )
);

check(
  "Chưa chọn ảnh Drive nào → loại Drive, giữ Pexels",
  JSON.stringify(
    mediaCandidates(
      cfg({
        mediaPrimary: "DRIVE",
        drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
        driveFileCount: 0,
      })
    )
  ) === '["PEXELS"]'
);

check(
  "Drive cần cấp quyền lại → loại Drive",
  JSON.stringify(
    mediaCandidates(
      cfg({
        mediaPrimary: "DRIVE",
        drive: { folderId: "f1", connectionStatus: "NEEDS_REAUTH" },
      })
    )
  ) === '["PEXELS"]'
);

check(
  "Drive bị tắt (DISABLED) → loại Drive",
  sourceBlocker("DRIVE", { drive: { folderId: "f1", connectionStatus: "DISABLED" }, pexelsReady: true, driveFileCount: 5 }) ===
    "DRIVE_DISABLED"
);

check(
  "Chưa có key Pexels + dự phòng bật → chỉ Drive",
  JSON.stringify(
    mediaCandidates(cfg({ mediaPrimary: "PEXELS", pexelsReady: false }))
  ) === '["DRIVE"]',
  JSON.stringify(mediaCandidates(cfg({ mediaPrimary: "PEXELS", pexelsReady: false })))
);

check(
  "Không nguồn nào khả dụng → []",
  mediaCandidates(
    cfg({ mediaPrimary: "DRIVE", pexelsReady: false, drive: null, driveFileCount: 0 })
  ).length === 0
);

check(
  "Không nguồn nào → lý do nói về Drive (nguồn chính)",
  noSourceReason(cfg({ mediaPrimary: "DRIVE", pexelsReady: false, drive: null, driveFileCount: 0 })).includes(
    "Chưa kết nối Google Drive"
  ),
  noSourceReason(cfg({ mediaPrimary: "DRIVE", pexelsReady: false, drive: null, driveFileCount: 0 }))
);

// ============================================================
section("Thư mục Drive: đếm theo ĐÚNG phạm vi mà AutoPilot sẽ chọn");
// ============================================================

// Ca thật đã gặp: gắn thư mục nhưng nội dung không đọc được (thiếu quyền rộng)
// → số ảnh theo thư mục = 0. Nếu code đếm toàn cục thì sẽ tưởng "có ảnh" rồi
// tạo bài không ảnh kèm cảnh báo sai.
check(
  "Gắn thư mục nhưng thư mục rỗng → loại DRIVE, rơi sang Pexels",
  JSON.stringify(
    mediaCandidates(
      cfg({
        mediaPrimary: "DRIVE",
        drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
        driveFileCount: 0,
      })
    )
  ) === '["PEXELS"]',
  JSON.stringify(
    mediaCandidates(
      cfg({
        mediaPrimary: "DRIVE",
        drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
        driveFileCount: 0,
      })
    )
  )
);

check(
  "Gắn thư mục VÀ có ảnh trong thư mục → DRIVE đứng đầu",
  JSON.stringify(
    mediaCandidates(
      cfg({
        mediaPrimary: "DRIVE",
        drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
        driveFileCount: 12,
      })
    )
  ) === '["DRIVE","PEXELS"]'
);

check(
  "Thư mục rỗng + tắt dự phòng + không có Pexels key → không nguồn nào",
  mediaCandidates(
    cfg({
      mediaPrimary: "DRIVE",
      mediaFallback: false,
      pexelsReady: false,
      drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
      driveFileCount: 0,
    })
  ).length === 0
);

check(
  "Lý do khi thư mục rỗng nhắc đúng việc cần làm (chọn ảnh từ Drive)",
  noSourceReason(
    cfg({
      mediaPrimary: "DRIVE",
      mediaFallback: false,
      drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
      driveFileCount: 0,
    })
  ).includes("Chọn ảnh/video từ Drive") ||
    noSourceReason(
      cfg({
        mediaPrimary: "DRIVE",
        mediaFallback: false,
        drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
        driveFileCount: 0,
      })
    ).includes("Chưa có ảnh/video Drive"),
  noSourceReason(
    cfg({
      mediaPrimary: "DRIVE",
      mediaFallback: false,
      drive: { folderId: "folder-1", connectionStatus: "ACTIVE" },
      driveFileCount: 0,
    })
  )
);

// ============================================================
section("Nguồn chính dùng được nhưng tắt dự phòng ⇒ cảnh báo đúng");
// ============================================================

const offFallbackReason = noSourceReason(
  cfg({ mediaPrimary: "DRIVE", mediaFallback: false, drive: null, driveFileCount: 0 })
);
check(
  "Tắt dự phòng + Drive không dùng được → lý do nhắc tới Drive",
  offFallbackReason.includes("Google Drive") || offFallbackReason.includes("Drive"),
  offFallbackReason
);

check(
  "Pexels thiếu key nhưng Drive sẵn sàng + tắt dự phòng → lý do nhắc Pexels key",
  noSourceReason(
    cfg({ mediaPrimary: "PEXELS", mediaFallback: false, pexelsReady: false })
  ).includes("Pexels API Key"),
  noSourceReason(cfg({ mediaPrimary: "PEXELS", mediaFallback: false, pexelsReady: false }))
);

// ============================================================
section("Thông báo khi phải dùng nguồn dự phòng");
// ============================================================

check(
  "Dùng đúng nguồn chính → không có thông báo",
  fallbackNotice("PEXELS", "PEXELS") === null
);
check(
  "Phải rơi sang Pexels → có thông báo nhắc Drive",
  (fallbackNotice("PEXELS", "DRIVE") ?? "").includes("Drive"),
  String(fallbackNotice("PEXELS", "DRIVE"))
);
check(
  "Phải rơi sang Drive → có thông báo nhắc Pexels",
  (fallbackNotice("DRIVE", "PEXELS") ?? "").includes("Pexels"),
  String(fallbackNotice("DRIVE", "PEXELS"))
);

// ============================================================
section("Hằng số dùng chung");
// ============================================================

check("Autopilot chỉ có DRIVE và PEXELS", AUTOPILOT_SOURCES.length === 2);
check("UPLOAD không phải nguồn tự động", isAutopilotSource("UPLOAD") === false);
check("DRIVE là nguồn tự động", isAutopilotSource("DRIVE") === true);
check("PEXELS là nguồn tự động", isAutopilotSource("PEXELS") === true);
check("Nhãn DRIVE có chữ Drive", MEDIA_SOURCE_LABEL.DRIVE.includes("Drive"));
check("Nhãn UPLOAD có chữ máy", MEDIA_SOURCE_LABEL.UPLOAD.includes("máy"));

// ============================================================
console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
