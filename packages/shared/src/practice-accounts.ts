/**
 * Practice-mode stand-in for the wallet account features. Balances move in the
 * same browser-local wallet as practice-wallet.ts. Nothing here is a real transfer.
 */
import { practiceWalletBalance, practiceWalletRefund, practiceWalletSpend } from "./practice-wallet.js";

type Json = Record<string, unknown>;
const KEY = "peebee_practice_accounts_v1";

const PEOPLE = [
  { id: "prac-nakato", name: "Nakato Sarah", phone: "0772000412" },
  { id: "prac-okello", name: "Okello Peter", phone: "0772000088" },
  { id: "prac-ssali", name: "Ssali Joan", phone: "0772000901" },
];

type Account = { id: string; name: string; balance: number; frozen?: boolean };
type Contact = { id: string; recipientId: string; name: string; nickname: string | null; maskedPhone: string };
type Request = { id: string; amount: number; note: string | null; status: string; intoWalletId: string; direction: "incoming" | "outgoing"; personName: string; maskedPhone: string; recipientId: string; expiresAt: string; snoozeUntil: null; createdAt: string };
type State = { accounts: Account[]; contacts: Contact[]; requests: Request[]; idem: Record<string, Json> };

function mask(phone: string) {
  return `${phone.slice(0, 2)}•• ••• ${phone.slice(-3)}`;
}
const memory: { state: State | null } = { state: null };
function box(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
function seedContacts(): Contact[] {
  return PEOPLE.map((p) => ({ id: `ct-${p.id}`, recipientId: p.id, name: p.name, nickname: null, maskedPhone: mask(p.phone) }));
}
function load(): State {
  const fresh = (): State => ({ accounts: [{ id: "home", name: "Home", balance: 120_000 }, { id: "travel", name: "Travel", balance: 224_500 }], contacts: seedContacts(), requests: [], idem: {} });
  try {
    const raw = box()?.getItem(KEY) ?? null;
    const parsed = raw ? JSON.parse(raw) as State : memory.state;
    if (parsed?.accounts) return parsed;
  } catch { /* reset */ }
  const state = memory.state ?? fresh();
  memory.state = state;
  save(state);
  return state;
}
function save(state: State) { memory.state = state; try { box()?.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }

function person(q: string) {
  const digits = q.replace(/\D/g, "");
  return PEOPLE.find((p) => p.phone === digits || (digits.length >= 9 && p.phone.endsWith(digits.slice(-9)))) ?? null;
}

export function practiceAccountsPayload(primaryBalance: number) {
  const state = load();
  const wallets = [
    { id: "primary", name: "Main Wallet", balance: primaryBalance, isPrimary: true, frozen: false },
    ...state.accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance, isPrimary: false, frozen: !!a.frozen })),
  ];
  return {
    wallets,
    suggestedNames: ["Home", "Office", "Travel", "Family Expenses"],
    maxWallets: 5,
    total: wallets.reduce((s, w) => s + w.balance, 0),
    includeFrozenInTotal: true,
    features: { freeze: true, requests: true, sendFromShared: false, nicknames: true, contactsMax: 50, requestContactsOnly: false, requestAllowCancel: true, requestNotify: true },
  };
}

/** Routes the live wallet screen calls that the older practice wallet did not answer. */
export function practiceWalletExtra(method: string, path: string, body: Json): { status: number; body: Json } | null {
  const state = load();
  if (method === "GET" && path === "/v1/wallet/contacts") return { status: 200, body: { contacts: state.contacts, available: true } };
  if (method === "GET" && path === "/v1/wallet/requests") return { status: 200, body: { requests: state.requests, incomingOpen: state.requests.filter((r) => r.direction === "incoming" && r.status === "open").length, available: true, enabled: true } };
  if (method === "GET" && path === "/v1/wallet/spending") return { status: 200, body: { period: "month", totalIn: 100_000, totalOut: 25_000, merchants: [{ id: "k", name: "Kampala Grill", logo: null }] } };
  if (method === "GET" && path === "/v1/wallet/lookup") {
    const found = person(String((new URL("http://x" + path)).searchParams.get("q") ?? ""));
    // query is not on the path when the caller passes it separately; practice-runtime passes path without search.
    return found ? { status: 200, body: { recipientId: found.id, name: found.name, maskedPhone: mask(found.phone) } } : { status: 404, body: { error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." } };
  }
  if (method === "POST" && path === "/v1/wallet/contacts") {
    const found = person(String(body.recipient ?? "")) ?? PEOPLE.find((p) => p.id === body.recipientId);
    if (!found) return { status: 404, body: { error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." } };
    const contact = { id: `ct-${found.id}`, recipientId: found.id, name: found.name, nickname: body.nickname ? String(body.nickname) : null, maskedPhone: mask(found.phone) };
    state.contacts = [contact, ...state.contacts.filter((c) => c.recipientId !== found.id)];
    save(state);
    return { status: 201, body: { contact } };
  }
  if (method === "POST" && path === "/v1/wallet/transfer") {
    const key = String(body.idempotencyKey ?? "");
    if (key && state.idem[key]) return { status: 200, body: state.idem[key] };
    const amount = Number(body.amount ?? 0);
    const named = state.accounts.find((a) => a.id === body.fromWalletId);
    if (named?.frozen) return { status: 409, body: { error: "account_frozen", message: "This account is frozen." } };
    if (named) {
      if (named.balance < amount) return { status: 409, body: { error: "insufficient_balance", message: "You don't have enough in that account." } };
      named.balance -= amount;
    } else if (!practiceWalletSpend(amount, "Practice send")) {
      return { status: 409, body: { error: "insufficient_balance", message: "You don't have enough in that account." } };
    }
    const who = PEOPLE.find((p) => p.id === body.recipientId) ?? person(String(body.recipient ?? ""));
    const reply = { balance: named ? named.balance : practiceWalletBalance(), recipientName: who?.name ?? "Peebee customer" };
    if (key) state.idem[key] = reply;
    save(state);
    return { status: 201, body: reply };
  }
  if (method === "POST" && path === "/v1/wallets") {
    if (state.accounts.length >= 4) return { status: 409, body: { error: "wallet_limit_reached", message: "You can have up to 5 accounts" } };
    const account = { id: `acc-${Date.now()}`, name: String(body.name ?? "Account"), balance: 0 };
    state.accounts.push(account);
    save(state);
    return { status: 201, body: { wallet: { ...account, isPrimary: false, frozen: false } } };
  }
  if (method === "PATCH" && /^\/v1\/wallets\/[^/]+$/.test(path)) {
    const id = path.split("/").pop()!;
    const account = state.accounts.find((a) => a.id === id);
    if (id !== "primary" && !account) return { status: 404, body: { error: "not_found" } };
    if (typeof body.frozen === "boolean") {
      if (body.frozen === false && body.confirm !== true) return { status: 400, body: { error: "confirm_required", message: "Confirm to unfreeze this account." } };
      if (account) account.frozen = body.frozen;
    }
    if (typeof body.name === "string" && account) account.name = body.name;
    save(state);
    return { status: 200, body: { ok: true, frozen: account?.frozen ?? false } };
  }
  if (method === "DELETE" && /^\/v1\/wallets\/[^/]+$/.test(path)) {
    const id = path.split("/").pop()!;
    const account = state.accounts.find((a) => a.id === id);
    if (!account) return { status: 404, body: { error: "not_found" } };
    if (account.balance !== 0) return { status: 409, body: { error: "wallet_not_empty", message: "Move any funds out of this account before deleting it" } };
    state.accounts = state.accounts.filter((a) => a.id !== id);
    save(state);
    return { status: 200, body: { ok: true } };
  }
  if (method === "POST" && path === "/v1/wallets/transfer") {
    const amount = Number(body.amount ?? 0);
    const from = state.accounts.find((a) => a.id === body.fromWalletId);
    const to = state.accounts.find((a) => a.id === body.toWalletId);
    if (from?.frozen) return { status: 409, body: { error: "account_frozen", message: "This account is frozen." } };
    if (body.fromWalletId === "primary") {
      if (!practiceWalletSpend(amount, "Move to another account")) return { status: 409, body: { error: "insufficient_balance", message: "Not enough in that account" } };
      if (to) to.balance += amount;
    } else if (from) {
      if (from.balance < amount) return { status: 409, body: { error: "insufficient_balance", message: "Not enough in that account" } };
      from.balance -= amount;
      if (body.toWalletId === "primary") practiceWalletRefund(amount, "Move from another account");
      else if (to) to.balance += amount;
    }
    save(state);
    return { status: 200, body: { fromBalance: from?.balance ?? practiceWalletBalance(), toBalance: to?.balance ?? practiceWalletBalance() } };
  }
  if (method === "POST" && path === "/v1/wallet/requests") {
    const found = person(String(body.payer ?? "")) ?? PEOPLE.find((p) => p.id === body.recipientId);
    if (!found) return { status: 404, body: { error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." } };
    const row: Request = { id: `rq-${Date.now()}`, amount: Number(body.amount), note: body.note ? String(body.note) : null, status: "open", intoWalletId: String(body.intoWalletId ?? "primary"), direction: "outgoing", personName: found.name, maskedPhone: mask(found.phone), recipientId: found.id, expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(), snoozeUntil: null, createdAt: new Date().toISOString() };
    state.requests.unshift(row);
    save(state);
    return { status: 201, body: { id: row.id, amount: row.amount, personName: found.name, maskedPhone: row.maskedPhone, notified: true } };
  }
  return null;
}

/** Lookup needs the query string, which is not part of the path. */
export function practiceLookup(q: string) {
  const found = person(q);
  if (!found) return { status: 404, body: { error: "recipient_not_found", message: "We couldn't find a Peebee customer with that phone number or email." } };
  return { status: 200, body: { recipientId: found.id, name: found.name, maskedPhone: mask(found.phone) } };
}
