// Explicitly opt in to adding test characters to a local SQLite database.
import "../src/env.js";
import { prisma } from "../src/lib/db.js";
import { seedDevAccounts } from "./devAccounts.js";

if (process.env.NODE_ENV !== "development" || process.env.TEST_LOGIN_ENABLED !== "1" || !process.env.DATABASE_URL?.startsWith("file:")) {
  throw new Error("Dev seed requires NODE_ENV=development, TEST_LOGIN_ENABLED=1 and a local SQLite DATABASE_URL");
}

try {
  const count = await prisma.$transaction(seedDevAccounts);
  console.log(`Dev accounts ready: ${count} players and reserve signups, 6 per rank (แม่ทัพไร้มงกุฎ → เจ้าแห่ง ZONE).`);
} finally {
  await prisma.$disconnect();
}
