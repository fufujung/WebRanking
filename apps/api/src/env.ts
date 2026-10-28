// Resolve the API's configuration relative to this file, regardless of the launch directory.
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch (error) {
  // Deployments can provide their configuration directly through the environment.
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
