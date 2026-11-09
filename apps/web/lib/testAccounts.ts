import accounts from "../../../dev-accounts.json";

export const testAccounts = accounts;

export function testLoginEnabled(host: string, env = process.env) {
  return env.NODE_ENV === "development" && env.TEST_LOGIN_ENABLED === "1" && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
}

export function findTestAccount(id: FormDataEntryValue | null) {
  return typeof id === "string" ? testAccounts.find((account) => account.id === id) : undefined;
}
