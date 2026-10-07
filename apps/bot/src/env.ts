// Loads apps/bot/.env before anything reads process.env. Must be the first import.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}
