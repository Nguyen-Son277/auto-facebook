// Seed DB TẠM để chạy thử vòng học khép kín. KHÔNG dùng cho DB thật.
//
// Tạo: user + workspace + brand + hồ sơ + 2 trụ cột + Page + AutoPilot bật
// insightsEnabled, cùng 12 bài AutoPilot đã đăng kèm số liệu để Page vào giai
// đoạn KHAI THÁC (đủ 8 mẫu chín), trong đó một trụ cột tốt và một trụ cột kém.
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { Client } from "pg";
import "dotenv/config";

const url = process.env.SEED_DATABASE_URL;
if (!url) throw new Error("Thiếu SEED_DATABASE_URL");
if (/supabase|amazonaws|neon|render/.test(url)) {
  throw new Error("TỪ CHỐI: script này chỉ chạy trên DB tạm cục bộ.");
}

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 16) throw new Error("Thiếu SESSION_SECRET");

function encryptValue(plain) {
  const key = scryptSync(secret, "fb-marketing-auto:app-settings:v1", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return (
    "enc:v1:" +
    [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
  );
}

const c = new Client({ connectionString: url });
await c.connect();

const now = new Date();
const day = 24 * 60 * 60 * 1000;
const at = (daysAgo, hour) => {
  const d = new Date(now.getTime() - daysAgo * day);
  d.setUTCHours(hour - 7, 0, 0, 0); // giờ VN → UTC
  return d;
};
const id = (p) => `${p}_${Math.random().toString(36).slice(2, 12)}`;

async function main() {
  const userId = id("usr");
  const wsId = id("ws");
  const brandId = id("brd");
  const pageId = id("pg");

  await c.query(
    `INSERT INTO "User" (id,email,password,name,role,"createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'USER',now(),now())`,
    [userId, `${id("e")}@test.local`, "x", "E2E Learning"]
  );
  // Bảng Workspace có thể đòi ownerId; thử chèn tối thiểu rồi bổ sung nếu lỗi.
  await c.query(
    `INSERT INTO "Workspace" (id,name,slug,"ownerId","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,now(),now())`,
    [wsId, "WS E2E", `ws-${wsId.slice(-8)}`, userId]
  );
  await c.query(
    `INSERT INTO "Brand" (id,"workspaceId",name,slug,"createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,now(),now())`,
    [brandId, wsId, "Thương hiệu E2E", `brd-${brandId.slice(-8)}`]
  );
  await c.query(
    `INSERT INTO "BrandProfile" (id,"userId","brandId",description,products,"serviceAreas","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
    [
      id("bp"),
      userId,
      brandId,
      "Cửa hàng rèm cửa tại Bình Dương.",
      "Rèm vải, rèm cuốn, rèm cầu vồng",
      "Dĩ An\nThủ Dầu Một",
    ]
  );

  const pillarGood = "Rèm vải cao cấp";
  const pillarBad = "Giới thiệu công ty";
  for (const [i, name] of [pillarGood, pillarBad].entries()) {
    await c.query(
      `INSERT INTO "ContentPillar" (id,"userId","brandId","pageId",name,weight,position,enabled,goal,"createdAt","updatedAt")
       VALUES ($1,$2,$3,NULL,$4,$5,$6,true,'engagement',now(),now())`,
      [id("pil"), userId, brandId, name, 50, i]
    );
  }

  await c.query(
    `INSERT INTO "FacebookPage" (id,"userId","workspaceId","brandId",name,"fbPageId","accessToken","isActive","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'enc-token',true,now(),now())`,
    [pageId, userId, wsId, brandId, "Page E2E", id("fb")]
  );

  await c.query(
    `INSERT INTO "AutoPilot"
       (id,"userId","pageId",enabled,mode,"postsPerDay","windowStart","windowEnd","daysOfWeek",
        "minGapMinutes","autoMedia","mediaPrimary","mediaFallback","mediaKind","mediaMix","videoPercent",
        "photosPerPost",length,"useHashtags","planAheadDays","insightsEnabled","learningPhase",
        "createdAt","updatedAt")
     VALUES ($1,$2,$3,true,'AUTO',2,'07:00','21:00','1,2,3,4,5,6,7',120,false,'PEXELS',true,
             'IMAGE','IMAGE_ONLY',25,2,'medium',true,2,true,'PROBE',now(),now())`,
    [id("ap"), userId, pageId]
  );

  // Hai key AI trỏ vào mock server để planner chạy được thật.
  for (const [key, value, group] of [
    ["ai.baseUrl", process.env.SEED_AI_BASE_URL ?? "http://127.0.0.1:4010/v1", "AI"],
    ["ai.apiKey", "test-key-abc123", "AI"],
    ["ai.model", "mock-gpt-4o", "AI"],
    ["pexels.apiKey", "pexels-test", "PEXELS"],
  ]) {
    await c.query(
      `INSERT INTO "UserSetting" (id,"userId",key,value,"group","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,now(),now())`,
      [id("set"), userId, key, encryptValue(value), group]
    );
  }

  // 12 bài đã đăng, đủ chín (>= 24h), có số liệu: trụ cột tốt ăn đứt trụ cột kém.
  const plan = [
    // [pillar, band hour, hook style, reactions, comments, shares, daysAgo]
    [pillarGood, 8, "ConSo", 320, 40, 12, 3],
    [pillarGood, 20, "DanhSach", 280, 35, 9, 4],
    [pillarGood, 8, "ConSo", 260, 30, 8, 6],
    [pillarGood, 9, "KeChuyen", 240, 28, 7, 8],
    [pillarGood, 20, "CauHoi", 300, 33, 10, 12],
    [pillarGood, 8, "ConSo", 270, 31, 9, 18],
    [pillarBad, 8, "CauHoi", 12, 1, 0, 3],
    [pillarBad, 20, "DanhSach", 9, 0, 0, 5],
    [pillarBad, 8, "KeChuyen", 15, 1, 0, 9],
    [pillarBad, 15, "CauHoi", 7, 0, 0, 14],
    [pillarBad, 8, "DanhSach", 11, 0, 0, 20],
    [pillarBad, 20, "KeChuyen", 6, 0, 0, 25],
  ];

  for (const [pillar, hour, hook, reactions, comments, shares, daysAgo] of plan) {
    const postId = id("post");
    const publishedAt = at(daysAgo, hour);
    await c.query(
      `INSERT INTO "Post"
         (id,"userId","workspaceId","brandId","pageId",content,hook,"hookStyle",status,
          "scheduledAt","publishedAt",origin,"pillarName",topic,"serviceArea","probeKind","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PUBLISHED',$9,$9,'AUTOPILOT',$10,$11,$12,'STANDARD',$9,$9)`,
      [
        postId,
        userId,
        wsId,
        brandId,
        pageId,
        `${hook} về ${pillar} — nội dung thử nghiệm cho vòng học.`,
        `${hook} về ${pillar}: điều khách hàng cần biết.`,
        hook,
        publishedAt,
        pillar,
        `${pillar} cho nhà phố`,
        daysAgo % 2 === 0 ? "Dĩ An" : "Thủ Dầu Một",
      ]
    );
    await c.query(
      `INSERT INTO "PostInsight"
         (id,"postId","pageId","fbPostId",reactions,comments,shares,"fetchedAt",status,"createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OK',now(),now())`,
      [id("ins"), postId, pageId, `fb_${postId}`, reactions, comments, shares, new Date()]
    );
  }

  console.log(
    JSON.stringify({ userId, wsId, brandId, pageId, pillarGood, pillarBad }, null, 2)
  );
}

await main();
await c.end();
