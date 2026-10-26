// Local-only OAuth and membership fixture. No real Discord credentials or users.
// Run: node apps/web/tests/fixtures/discord.mjs
import http from "node:http";
import { randomUUID } from "node:crypto";

const accounts = {
  member: {
    id: "424242424242424242",
    global_name: "Overtime Player",
    username: "player",
  },
  outsider: {
    id: "434343434343434343",
    global_name: "New Player",
    username: "new_player",
  },
  outage: {
    id: "444444444444444444",
    global_name: "Retry Player",
    username: "retry_player",
  },
};
const grants = new Map();
const joined = new Set([accounts.member.id]);
const page = (body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Local Discord test fixture</title></head><body><h1>Local Discord test fixture</h1>${body}</body></html>`;
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1:4998");
    const json = (status, value) =>
      res
        .writeHead(status, { "Content-Type": "application/json" })
        .end(JSON.stringify(value));
    if (url.pathname === "/oauth2/authorize") {
      if (!url.searchParams.has("account")) {
        const links = Object.keys(accounts)
          .map((account) => {
            const link = new URL(url);
            link.searchParams.set("account", account);
            return `<p><a href="${link.pathname}${link.search.replaceAll("&", "&amp;")}">Continue as ${account}</a></p>`;
          })
          .join("");
        return res
          .writeHead(200, { "Content-Type": "text/html" })
          .end(page(links));
      }
      const account = accounts[url.searchParams.get("account")];
      if (!account) return json(400, {});
      const code = randomUUID();
      grants.set(code, account);
      const back = new URL(url.searchParams.get("redirect_uri"));
      if (!["localhost", "127.0.0.1"].includes(back.hostname))
        return json(400, {});
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state"));
      return res.writeHead(302, { Location: back.href }).end();
    }
    if (url.pathname === "/api/oauth2/token") {
      let body = "";
      for await (const part of req) body += part;
      const code = new URLSearchParams(body).get("code");
      if (!grants.has(code)) return json(401, {});
      return json(200, { access_token: code, token_type: "Bearer" });
    }
    if (url.pathname === "/api/users/@me") {
      const user = grants.get(
        req.headers.authorization?.replace("Bearer ", ""),
      );
      return json(user ? 200 : 401, user ?? {});
    }
    if (url.pathname.startsWith("/api/guilds/")) {
      if (req.headers.authorization !== "Bot local-test-token")
        return json(401, {});
      const id = url.pathname.split("/").at(-1);
      if (id === accounts.outage.id) return json(503, {});
      return joined.has(id)
        ? json(200, { user: { id }, pending: false })
        : json(404, { code: 10007 });
    }
    if (url.pathname === "/join") {
      joined.add(accounts.outsider.id);
      return res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(
          page(
            '<p>New Player joined the test server.</p><a href="http://localhost:3100/login">Return to The Ranking and recheck membership</a>',
          ),
        );
    }
    return res
      .writeHead(200, { "Content-Type": "text/html" })
      .end(page('<a href="/join">Join the test server as New Player</a>'));
  })
  .listen(4998, "127.0.0.1", () =>
    console.log("Local Discord fixture: http://127.0.0.1:4998"),
  );
