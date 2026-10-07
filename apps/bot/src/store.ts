import fs from "node:fs";
import path from "node:path";

/** A tiny JSON file store: survives bot restarts, fine for a handful of servers. */
export class JsonStore<T extends object> {
  private data: Record<string, T>;
  constructor(private file: string) {
    try {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      this.data = {};
    }
  }
  get(key: string): T | undefined {
    return this.data[key];
  }
  set(key: string, value: T) {
    this.data[key] = value;
    this.save();
  }
  delete(key: string) {
    delete this.data[key];
    this.save();
  }
  entries() {
    return Object.entries(this.data);
  }
  /** Drops entries the predicate rejects. */
  prune(keep: (value: T) => boolean) {
    const before = Object.keys(this.data).length;
    this.data = Object.fromEntries(Object.entries(this.data).filter(([, v]) => keep(v)));
    if (Object.keys(this.data).length !== before) this.save();
  }
  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
