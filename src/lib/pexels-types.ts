// Kiểu dữ liệu thuần (không import server-only) để client component
// và server action dùng chung mà không kéo code server xuống browser.

export type MediaType = "IMAGE" | "VIDEO";

export type PexelsPhoto = {
  id: string;
  type: "IMAGE";
  width: number;
  height: number;
  /** URL file ảnh chất lượng lớn — dùng để đăng lên Facebook. */
  remoteUrl: string;
  /** Ảnh nhỏ để hiển thị preview trong lưới. */
  previewUrl: string;
  /** Màu trung bình — dùng làm nền placeholder khi ảnh chưa tải xong. */
  avgColor?: string;
  alt?: string;
  /** Trang chi tiết trên Pexels (ghi nguồn). */
  pageUrl?: string;
  photographer?: string;
  photographerUrl?: string;
};

export type PexelsVideo = {
  id: string;
  type: "VIDEO";
  width: number;
  height: number;
  remoteUrl: string;
  previewUrl: string;
  duration: number;
  pageUrl?: string;
  photographer?: string;
  photographerUrl?: string;
};

export type PexelsMediaItem = PexelsPhoto | PexelsVideo;

/** Kết quả một lần tìm kiếm Pexels (dùng cho UI). */
export type MediaSearchState = {
  ok?: boolean;
  error?: string;
  items?: PexelsMediaItem[];
  keyword?: string;
  mediaType?: MediaType;
  page?: number;
  hasNextPage?: boolean;
  totalResults?: number;
  cached?: boolean;
  /** true khi đang xem danh sách phổ biến (không nhập từ khóa). */
  curated?: boolean;
} | null;

export type KeywordState = {
  ok?: boolean;
  error?: string;
  keywords?: { label: string; query: string }[];
} | null;

export type LibraryState = {
  ok?: boolean;
  error?: string;
  message?: string;
} | null;
