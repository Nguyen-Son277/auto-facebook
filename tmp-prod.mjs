import "dotenv/config";
import pg from "pg";
import { SignJWT } from "jose";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "https://auto.nguyenminhson.me";
const PATH = process.env.PATHNAME ?? "/composer";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL.replace(":5432/postgres", ":6543/postgres"),
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows } = await c.query('SELECT id, email, name FROM "User" WHERE role = $1 LIMIT 1', [
  "ADMIN",
]);
await c.end();

const token = await new SignJWT({ userId: rows[0].id, email: rows[0].email, name: rows[0].name })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET));

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  timezoneId: process.env.TIMEZONE ?? "Asia/Ho_Chi_Minh",
  locale: "vi-VN",
});
await ctx.addCookies([
  { name: "session", value: token, domain: new URL(BASE).hostname, path: "/", httpOnly: true },
]);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 120)));
page.on("response", (r) => {
  if (r.status() >= 400) errs.push(`http ${r.status()} ${r.url()}`);
});

await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

const status = page.url();
const body = await page.locator("body").innerText().catch(() => "");
const broken = body.includes("server error") || body.includes("couldn’t load");
console.log(`${PATH}: ${broken ? "❌ LỖI" : "✅ OK"} | lỗi=${errs.length}`);
console.log("   " + body.replace(/\n+/g, " | ").slice(0, 180));
if (errs.length) console.log("   " + errs.slice(0, 3).join(" ; "));

await browser.close();
