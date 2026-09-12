import "dotenv/config";
import pg from "pg";
import { SignJWT } from "jose";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
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
  .setExpirationTime("2h")
  .sign(new TextEncoder().encode(process.env.SESSION_SECRET));

process.stdout.write(token);
