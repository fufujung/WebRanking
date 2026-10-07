import "../env.js";
// Usage: npm run key:create -- "My website" read|admin
import { createApiKey } from "../lib/apiKeys.js";
import { prisma } from "../lib/db.js";

const [name = "Default key", scope = "read"] = process.argv.slice(2);
if (scope !== "read" && scope !== "admin") {
  console.error('Scope must be "read" or "admin"');
  process.exit(1);
}
const { key } = await createApiKey(name, scope);
console.log(`Created ${scope} key "${name}". Store it now; it is not shown again:\n\n  ${key}\n`);
await prisma.$disconnect();
