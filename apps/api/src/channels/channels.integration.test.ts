import test from "node:test";
import assert from "node:assert/strict";
import { addVideo, setup, type Json } from "./test-harness.js";
import { setModuleFlags } from "../lib/modules.js";

const MONEY_ON = { monetization: { enabled: true }, kyc: { withdrawalsEnabled: true, payoutAccountCooldownDays: 0 } };

async function world() {
  const t = await setup();
  const admin = await t.mkUser("admin1", "admin");
  const creator = await t.mkUser("creator", "customer", "Amina Nakato");
  const fan = await t.mkUser("fan", "customer", "Joseph Okello");
  const other = await t.mkUser("other");
  await t.configure(admin, { enabled: true, moderation: { reviewFirstPosts: 0 } });
  return { ...t, admin, creator, fan, other };
}

async function openChannel(w: Awaited<ReturnType<typeof world>>, token = w.creator, handle = "amina") {
  const r = await w.call("/channels", { token, body: { handle, displayName: "Amina's Kitchen", bio: "Cooking", ageConfirmed: true } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.channel as Json;
}

test("channels: everything is off until an admin turns it on, and a missing migration is harmless", async () => {
  const t = await setup();
  const admin = await t.mkUser("admin1", "admin");
  const user = await t.mkUser("u1");
  assert.equal((await t.call("/channels/config")).json.enabled, false);
  assert.equal((await t.call("/channels", { token: user, body: { handle: "abc", displayName: "A", ageConfirmed: true } })).status, 503);
  assert.deepEqual((await t.call("/spotlight/feed")).json.posts, []);
  assert.equal((await t.call("/public/channels/nobody")).status, 503);

  const bare = await setup({ migrate: false });
  const a2 = await bare.mkUser("admin1", "admin");
  const u2 = await bare.mkUser("u1");
  await bare.call("/admin/channels/config", { method: "PUT", token: a2, body: { enabled: true } });
  assert.equal((await bare.call("/channels", { token: u2, body: { handle: "abc", displayName: "A", ageConfirmed: true } })).status, 503, "no tables yet: unavailable, not a crash");
  const overview = await bare.call("/admin/channels", { token: a2 });
  assert.equal(overview.status, 200);
  assert.equal(overview.json.migrationApplied, false);
  void admin;
});

test("channels: every setting is validated and clamped, and changes are logged", async () => {
  const w = await world();
  const r = await w.call("/admin/channels/config", { method: "PUT", token: w.admin, body: { causes: { maxGoalUgx: -5, minGoalUgx: 50_000_000 }, monetization: { membershipCutPercent: 500 }, publishing: { postTypes: ["video", "bogus"] } } });
  assert.equal(r.status, 200);
  assert.equal(r.json.config.monetization.membershipCutPercent, 90, "cut is capped");
  assert.ok(r.json.config.causes.maxGoalUgx >= r.json.config.causes.minGoalUgx, "max never below min");
  assert.deepEqual(r.json.config.publishing.postTypes, ["video"], "unknown types are dropped");
  assert.equal((await w.call("/admin/channels/config", { method: "PUT", token: w.creator, body: { enabled: false } })).status, 403);
  const log = await w.client.execute("SELECT COUNT(*) AS n FROM admin_activity_log WHERE action = 'channels.config.update'");
  assert.ok(Number(log.rows[0]!.n) >= 2);
  const cfg = await w.call("/admin/channels/config", { token: w.admin });
  assert.ok(cfg.json.fields.length > 80 && cfg.json.sections.length === 9, "the Admin screen is drawn from the field list");
});

test("channels: anyone can open or convert, no ID asked, handle rules hold", async () => {
  const w = await world();
  const open = (token: string, body: Json) => w.call("/channels", { token, body });
  assert.equal((await open(w.creator, { handle: "amina", displayName: "Amina" })).json.error, "age_declaration_required");
  assert.equal((await open(w.creator, { handle: "a", displayName: "Amina", ageConfirmed: true })).json.error, "invalid_handle");
  assert.equal((await open(w.creator, { handle: "admin", displayName: "Amina", ageConfirmed: true })).json.error, "invalid_handle", "reserved");
  assert.equal((await open(w.creator, { handle: "bad handle!", displayName: "Amina", ageConfirmed: true })).json.error, "invalid_handle");
  const ch = await openChannel(w);
  assert.equal(ch.handle, "amina");
  assert.equal((await open(w.creator, { handle: "another", displayName: "Two", ageConfirmed: true })).status, 409, "one channel per account");
  assert.equal((await open(w.fan, { handle: "AMINA", displayName: "Copy", ageConfirmed: true })).json.error, "handle_taken", "case-insensitive");
  const kyc = await w.call("/creator/kyc", { token: w.creator });
  assert.equal(kyc.json.status, "none", "no verification was needed to open a channel");

  const me = await w.call("/channels/me", { token: w.creator });
  assert.equal(me.json.channel.handle, "amina");
  assert.ok(me.json.identities.some((i: Json) => i.type === "channel") && me.json.identities.some((i: Json) => i.type === "personal"));

  const upd = await w.call("/channels/me", { method: "PATCH", token: w.creator, body: { bio: "New bio", handle: "amina_k" } });
  assert.equal(upd.status, 200);
  assert.equal((await w.call("/channels/me", { method: "PATCH", token: w.creator, body: { handle: "amina_two" } })).json.error, "handle_cooldown");
  assert.equal((await w.call("/public/channels/amina_k")).json.channel.bio, "New bio");

  await w.configure(w.admin, { general: { channelsOpen: false } });
  assert.equal((await open(w.other, { handle: "late", displayName: "Late", ageConfirmed: true })).json.error, "channels_closed");
});

test("channels: pictures upload to public media, ID documents never do", async () => {
  const w = await world();
  const up = await w.call("/channels/media", { token: w.creator, form: w.picture() });
  assert.equal(up.status, 201, up.text);
  const get = await app_get(w, up.json.path);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  const bad = new FormData();
  bad.set("file", new File(["<script>"], "x.html", { type: "text/html" }));
  assert.equal((await w.call("/channels/media", { token: w.creator, form: bad })).json.error, "unsupported_file_type");
  const doc = await w.call("/creator/kyc/documents", { token: w.creator, form: w.picture("id.png") });
  assert.equal(doc.status, 201);
  assert.ok(doc.json.key.startsWith("kyc/creator/"));
  const leak = await app_get(w, `/v1/public/media/${doc.json.key}`);
  assert.equal(leak.status, 404, "ID photos are not reachable through the public media route");
});

async function app_get(w: Awaited<ReturnType<typeof world>>, path: string) {
  const { default: app } = await import("../app.js");
  const res = await app.request(path);
  return { status: res.status, headers: res.headers };
}

test("posts: one post model for every publisher, in one ranked Spotlight", async () => {
  const w = await world();
  const ch = await openChannel(w);
  const pic = (await w.call("/channels/media", { token: w.creator, form: w.picture() })).json.path as string;
  const pic2 = (await w.call("/channels/media", { token: w.creator, form: w.picture() })).json.path as string;
  const mk = (token: string, body: Json) => w.call("/posts", { token, body: { publish: true, ...body } });

  const text = await mk(w.creator, { publisherType: "channel", publisherId: ch.id, type: "text", caption: "Hello world" });
  assert.equal(text.status, 201, text.text);
  assert.equal(text.json.post.status, "published");
  const carousel = await mk(w.creator, { publisherType: "channel", publisherId: ch.id, type: "carousel", images: [pic, pic2], caption: "Pics" });
  assert.equal(carousel.json.post.media.images.length, 2);
  assert.equal((await mk(w.creator, { publisherType: "channel", publisherId: ch.id, type: "carousel", images: [pic] })).json.error, "carousel_size");
  assert.equal((await mk(w.creator, { publisherType: "channel", publisherId: ch.id, type: "audio", audioPath: pic })).json.error, "post_type_unavailable", "audio is off by default");
  assert.equal((await mk(w.creator, { publisherType: "channel", publisherId: ch.id, type: "text", caption: "x", access: "members" })).json.error, "locking_unavailable", "money is off by default");

  // A plain account with no channel posts as a personal profile.
  const personal = await mk(w.fan, { publisherType: "personal", publisherId: "fan", type: "text", caption: "Hi from a customer" });
  assert.equal(personal.status, 201);
  assert.equal((await mk(w.fan, { publisherType: "channel", publisherId: ch.id, type: "text", caption: "Pretending" })).json.error, "not_your_identity", "cannot post as someone else's channel");

  // A restaurant and a driver post through the same model.
  await w.client.execute({ sql: "INSERT INTO restaurants (id, owner_id, name, status, environment) VALUES ('rest1', 'other', 'Mama Rose Kitchen', 'active', 'sandbox')", args: [] });
  const rest = await mk(w.other, { publisherType: "restaurant", publisherId: "rest1", type: "text", caption: "Fresh matooke today" });
  assert.equal(rest.status, 201, rest.text);
  const rider = await w.mkUser("rider1", "rider", "Peter Mugisha");
  const drive = await mk(rider, { publisherType: "driver", publisherId: "rider1", type: "text", caption: "Open for rides" });
  assert.equal(drive.status, 201, drive.text);

  const feed = await w.call("/spotlight/feed", { token: w.fan });
  assert.equal(feed.status, 200);
  const types = feed.json.posts.map((p: Json) => p.publisher.type).sort();
  assert.deepEqual(types, ["channel", "channel", "driver", "personal", "restaurant"]);
  const channelPost = feed.json.posts.find((p: Json) => p.publisher.type === "channel");
  assert.equal(channelPost.publisher.handle, "amina");

  // A publisher's posts leave the Spotlight while the Services module behind it is switched off.
  const publishers = async () => (await w.call("/spotlight/feed", { token: w.fan })).json.posts.map((p: Json) => p.publisher.type);
  await setModuleFlags({ live: { "buy.food": false } });
  assert.ok(!(await publishers()).includes("restaurant") && (await publishers()).includes("driver"), "Food off: restaurant posts go, the rest stay");
  await setModuleFlags({ live: { "buy.food": true, ride: false } });
  assert.ok((await publishers()).includes("restaurant") && !(await publishers()).includes("driver"), "Rides off: driver posts go");
  await setModuleFlags({ live: { ride: true } });

  await w.configure(w.admin, { publishing: { publishers: ["channel"] } });
  const narrowed = await w.call("/spotlight/feed", { token: w.fan });
  assert.ok(narrowed.json.posts.every((p: Json) => ["channel", "personal"].includes(p.publisher.type)), "the admin controls which publishers appear");
  await w.configure(w.admin, { publishing: { personalPosting: false } });
  assert.equal((await mk(w.fan, { publisherType: "personal", publisherId: "fan", type: "text", caption: "Nope" })).json.error, "publisher_unavailable");

  // Channel page and following.
  const page = await w.call("/public/channels/amina/posts");
  assert.equal(page.json.posts.length, 2);
  assert.equal((await w.call(`/channels/${ch.id}/follow`, { method: "POST", token: w.fan })).status, 200);
  assert.equal((await w.call("/public/channels/amina", { token: w.fan })).json.channel.isFollowing, true);
  assert.equal((await w.call("/public/channels/amina")).json.channel.followerCount, 1);
  const following = await w.call("/spotlight/feed?filter=following", { token: w.fan });
  assert.ok(following.json.posts.length === 2 && following.json.posts.every((p: Json) => p.publisher.type === "channel"));
  assert.equal((await w.call(`/channels/${ch.id}/follow`, { method: "POST", token: w.creator })).status, 400, "cannot follow yourself");
});

test("posts: drafts, scheduling, moderation, reports and editing", async () => {
  const w = await world();
  const ch = await openChannel(w);
  const draft = await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "Draft" } });
  assert.equal(draft.json.post.status, "draft");
  assert.equal((await w.call("/public/channels/amina/posts")).json.posts.length, 0, "drafts are private");
  assert.equal((await w.call(`/posts/${draft.json.post.id}`)).status, 404);
  assert.equal((await w.call(`/posts/${draft.json.post.id}`, { token: w.creator })).status, 200);
  const published = await w.call(`/posts/${draft.json.post.id}/publish`, { token: w.creator, body: {} });
  assert.equal(published.json.post.status, "published");

  // Scheduled for the future, then published by the sweep once due.
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const sched = await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "Later", publish: true, scheduledAt: future } });
  assert.equal(sched.json.post.status, "scheduled");
  const { sweepChannels } = await import("./scheduled.js");
  assert.equal((await sweepChannels()).published, 0);
  await w.client.execute({ sql: "UPDATE posts SET scheduled_at = datetime('now', '-1 minute') WHERE id = ?", args: [sched.json.post.id] });
  assert.equal((await sweepChannels()).published, 1);
  assert.equal((await w.call(`/posts/${sched.json.post.id}`)).json.post.status, "published");

  // Reports hide a post once enough arrive; staff decide.
  await w.configure(w.admin, { moderation: { autoHideAtReports: 2 } });
  const target = published.json.post.id as string;
  const reporters = [await w.mkUser("r1"), await w.mkUser("r2")];
  for (const r of reporters) assert.equal((await w.call(`/posts/${target}/report`, { token: r, body: { reason: "spam" } })).status, 200);
  assert.equal((await w.call(`/posts/${target}`)).status, 404, "hidden pending review");
  const queue = await w.call("/admin/channels/posts?status=review", { token: w.admin });
  assert.equal(queue.json.posts.length, 1);
  const rep = await w.call("/admin/channels/reports", { token: w.admin });
  assert.equal(rep.json.reports.length, 2);
  assert.equal((await w.call(`/admin/channels/reports/${rep.json.reports[0].id}/resolve`, { method: "POST", token: w.admin, body: { action: "remove_post" } })).json.error, "reason_required");
  assert.equal((await w.call(`/admin/channels/reports/${rep.json.reports[0].id}/resolve`, { method: "POST", token: w.admin, body: { action: "dismiss" } })).status, 200);
  assert.equal((await w.call(`/posts/${target}`)).status, 200, "dismissing restores it");
  assert.equal((await w.call(`/posts/${target}/report`, { token: w.creator, body: { reason: "spam" } })).json.error, "own_post");

  // "Before they show" sends everything to staff first.
  await w.configure(w.admin, { moderation: { mode: "before" } });
  const held = await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "Held", publish: true } });
  assert.equal(held.json.post.status, "review");
  assert.equal((await w.call(`/admin/channels/posts/${held.json.post.id}/moderate`, { method: "POST", token: w.creator, body: { action: "approve" } })).status, 403);
  assert.equal((await w.call(`/admin/channels/posts/${held.json.post.id}/moderate`, { method: "POST", token: w.admin, body: { action: "approve" } })).status, 200);
  assert.equal((await w.call(`/posts/${held.json.post.id}`)).json.post.status, "published");

  // New publishers' first posts and blocked words.
  await w.configure(w.admin, { moderation: { mode: "after", reviewFirstPosts: 2, blockedWords: "scam" } });
  const other = await w.mkUser("newbie");
  const ch2 = (await w.call("/channels", { token: other, body: { handle: "newbie", displayName: "N", ageConfirmed: true } })).json.channel;
  const first = await w.call("/posts", { token: other, body: { publisherType: "channel", publisherId: ch2.id, type: "text", caption: "first", publish: true } });
  assert.equal(first.json.post.status, "review", "a new publisher's first posts are reviewed");
  const flagged = await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "this is a SCAM offer", publish: true } });
  assert.equal(flagged.json.post.status, "review", "a blocked word holds the post");
});

test("posts: comments, likes and polls", async () => {
  const w = await world();
  const ch = await openChannel(w);
  const post = (await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "Which dish?", poll: { question: "Pick one", options: ["Matooke", "Rice"] }, publish: true } })).json.post;
  assert.equal(post.poll.options.length, 2);
  assert.equal((await w.call(`/posts/${post.id}/vote`, { token: w.fan, body: { option: 1 } })).status, 200);
  assert.equal((await w.call(`/posts/${post.id}/vote`, { token: w.other, body: { option: 1 } })).status, 200);
  assert.equal((await w.call(`/posts/${post.id}/vote`, { token: w.fan, body: { option: 0 } })).status, 200, "a second vote is ignored");
  const seen = (await w.call(`/posts/${post.id}`, { token: w.fan })).json.post;
  assert.equal(seen.poll.total, 2);
  assert.equal(seen.poll.options[1].votes, 2);
  assert.equal(seen.poll.myVote, 1);

  assert.equal((await w.call(`/posts/${post.id}/like`, { token: w.fan })).json.liked, true);
  assert.equal((await w.call(`/posts/${post.id}/like`, { token: w.fan })).json.liked, false);
  await w.call(`/posts/${post.id}/like`, { token: w.fan });
  assert.equal((await w.call(`/posts/${post.id}`)).json.post.counts.likes, 1);

  const cm = await w.call(`/posts/${post.id}/comments`, { token: w.fan, body: { body: "Looks great" } });
  assert.equal(cm.status, 201);
  const list = await w.call(`/posts/${post.id}/comments`, { token: w.creator });
  assert.equal(list.json.comments[0].author, "Joseph");
  assert.equal(list.json.comments[0].canDelete, true, "the post's author can remove comments");
  assert.equal((await w.call(`/comments/${cm.json.id}`, { method: "DELETE", token: w.other })).status, 404);
  assert.equal((await w.call(`/comments/${cm.json.id}`, { method: "DELETE", token: w.creator })).status, 200);
  assert.equal((await w.call(`/posts/${post.id}`)).json.post.counts.comments, 0);

  await w.configure(w.admin, { publishing: { commentsEnabled: false, reactionsEnabled: false } });
  assert.equal((await w.call(`/posts/${post.id}/comments`, { token: w.fan, body: { body: "x" } })).json.error, "comments_off");
  assert.equal((await w.call(`/posts/${post.id}/like`, { token: w.fan })).json.error, "likes_off");
});

test("memberships and paid posts: locked on the server, money through the ledger", async () => {
  const w = await world();
  const ch = await openChannel(w);
  const mkTier = (body: Json) => w.call("/creator/tiers", { token: w.creator, body });
  assert.equal((await mkTier({ name: "Fan", priceUgx: 5000 })).status, 503, "money is off by default");
  await w.configure(w.admin, MONEY_ON);
  assert.equal((await mkTier({ name: "Fan", priceUgx: 5 })).json.error, "invalid_price");
  const tier = (await mkTier({ name: "Fan", priceUgx: 10_000, perks: ["Early access"] })).json.id as string;

  const pic = (await w.call("/channels/media", { token: w.creator, form: w.picture() })).json.path as string;
  const members = await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "image", images: [pic], caption: "Members only recipe: soak the beans overnight and cook slowly with onions", access: "members", publish: true } });
  assert.equal(members.status, 201, members.text);
  const ppv = await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "The secret masterclass notes in full detail", access: "pay_per_view", priceUgx: 2000, publish: true } });
  assert.equal(ppv.status, 201, ppv.text);
  assert.equal((await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "x", access: "pay_per_view", priceUgx: 5, publish: true } })).json.error, "invalid_price");

  // A stranger sees a locked shell, never the content.
  const shell = (await w.call(`/posts/${members.json.post.id}`, { token: w.fan })).json.post;
  assert.ok(shell.locked && shell.locked.reason === "locked_members");
  assert.deepEqual(shell.media.images, [], "the pictures are withheld");
  assert.ok(shell.caption.length <= 80, "the caption is cut short");
  assert.equal((await w.call(`/posts/${members.json.post.id}`)).json.post.locked.reason, "locked_sign_in");
  assert.equal((await w.call(`/posts/${members.json.post.id}/comments`, { token: w.fan, body: { body: "hi" } })).json.error, "locked");

  // Not enough in the wallet.
  assert.equal((await w.call(`/tiers/${tier}/subscribe`, { token: w.fan })).json.error, "insufficient_wallet");
  await w.fund("fan", 30_000);
  const sub = await w.call(`/tiers/${tier}/subscribe`, { token: w.fan });
  assert.equal(sub.status, 201, sub.text);
  assert.equal(await w.wallet("fan"), 20_000);
  assert.equal((await w.call(`/tiers/${tier}/subscribe`, { token: w.fan })).json.error, "already_member");

  const earn = await w.call("/creator/earnings", { token: w.creator });
  assert.equal(earn.json.availableUgx, 8_500, "10,000 less Peebee's 15%");
  assert.equal(earn.json.members, 1);
  const unlocked = (await w.call(`/posts/${members.json.post.id}`, { token: w.fan })).json.post;
  assert.equal(unlocked.locked, null);
  assert.equal(unlocked.media.images.length, 1);
  assert.equal((await w.call(`/posts/${members.json.post.id}/comments`, { token: w.fan, body: { body: "thanks" } })).status, 201);

  // Pay-per-view is separate from membership by default, and unlocks once per person.
  assert.equal((await w.call(`/posts/${ppv.json.post.id}`, { token: w.fan })).json.post.locked.reason, "locked_pay_per_view");
  assert.equal((await w.call(`/posts/${ppv.json.post.id}/unlock`, { token: w.fan })).status, 200);
  assert.equal((await w.call(`/posts/${ppv.json.post.id}/unlock`, { token: w.fan })).status, 200, "repeat is free");
  assert.equal(await w.wallet("fan"), 18_000);
  assert.equal((await w.call(`/posts/${ppv.json.post.id}`, { token: w.fan })).json.post.locked, null);
  assert.equal((await w.call("/creator/earnings", { token: w.creator })).json.availableUgx, 8_500 + 1_600, "2,000 less 20%");
  await w.configure(w.admin, { monetization: { membersGetPayPerViewFree: true } });
  assert.equal((await w.call(`/posts/${ppv.json.post.id}`, { token: await w.mkUser("m2") })).json.post.locked.reason, "locked_pay_per_view");

  // Tips and gifts; a creator cannot tip themselves.
  assert.equal((await w.call(`/channels/${ch.id}/tip`, { token: w.fan, body: { amountUgx: 1000 } })).status, 201);
  assert.equal((await w.call(`/channels/${ch.id}/tip`, { token: w.fan, body: { gift: "Rose" } })).status, 201);
  assert.equal((await w.call(`/channels/${ch.id}/tip`, { token: w.fan, body: { gift: "Nonsense" } })).json.error, "unknown_gift");
  assert.equal((await w.call(`/channels/${ch.id}/tip`, { token: w.fan, body: { amountUgx: 1 } })).json.error, "invalid_amount");
  assert.equal((await w.call(`/channels/${ch.id}/tip`, { token: w.creator, body: { amountUgx: 1000 } })).json.error, "own_channel");
  assert.equal(await w.wallet("fan"), 18_000 - 1_000 - 1_000);

  // The ledger balances, and the cached balance matches it.
  const sums = await w.client.execute("SELECT transaction_id, SUM(amount) AS s FROM ledger_entries GROUP BY transaction_id");
  assert.ok(sums.rows.length >= 4 && sums.rows.every((r) => Number(r.s) === 0), "every transaction nets to zero");
  const ledger = await w.client.execute("SELECT COALESCE(SUM(e.amount), 0) AS b FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.owner_id = 'creator' AND a.purpose = 'creator_earnings'");
  assert.equal(Number(ledger.rows[0]!.b), (await w.call("/creator/earnings", { token: w.creator })).json.availableUgx);
  const fees = await w.client.execute("SELECT COALESCE(SUM(e.amount), 0) AS b FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.purpose = 'channel_fees'");
  assert.equal(Number(fees.rows[0]!.b), 1_500 + 400 + 100 + 100, "Peebee's cuts: 15% + 20% + 10% + 10%");

  // Renewal charges the member again; with no money the membership ends.
  const { renewSubscriptions } = await import("./money.js");
  await w.client.execute("UPDATE channel_subscriptions SET current_period_end = datetime('now', '-1 minute')");
  await w.fund("fan", 100_000 - (await w.wallet("fan")) + 10_000 - 10_000);
  assert.deepEqual(await renewSubscriptions(), { renewed: 1, expired: 0 });
  assert.equal((await w.call("/creator/earnings", { token: w.creator })).json.members, 1);
  await w.client.execute("UPDATE channel_subscriptions SET current_period_end = datetime('now', '-1 minute')");
  await w.client.execute("UPDATE users SET wallet_balance_sandbox = 0, wallet_balance = 0 WHERE id = 'fan'");
  assert.deepEqual(await renewSubscriptions(), { renewed: 0, expired: 1 });
  assert.equal((await w.call(`/posts/${members.json.post.id}`, { token: w.fan })).json.post.locked.reason, "locked_members");

  // Cancelling keeps access to the end of the period, with no more charges.
  await w.fund("fan", 20_000);
  const again = await w.call(`/tiers/${tier}/subscribe`, { token: w.fan });
  await w.call(`/subscriptions/${again.json.subscription.id}`, { method: "DELETE", token: w.fan });
  assert.equal((await w.call(`/posts/${members.json.post.id}`, { token: w.fan })).json.post.locked, null);
  await w.client.execute("UPDATE channel_subscriptions SET current_period_end = datetime('now', '-1 minute')");
  assert.deepEqual(await renewSubscriptions(), { renewed: 0, expired: 1 });
});

test("locked video: signed only for the entitled, one short preview for everyone else", async () => {
  const w = await world();
  const ch = await openChannel(w);
  await w.configure(w.admin, MONEY_ON);
  const tier = (await w.call("/creator/tiers", { token: w.creator, body: { name: "Fan", priceUgx: 5000 } })).json.id as string;
  const open = await addVideo(w.client, "creator", { protectedVideo: false });
  const locked = await addVideo(w.client, "creator", { protectedVideo: true });
  const body = { publisherType: "channel", publisherId: ch.id, type: "video", access: "members", publish: true };
  assert.equal((await w.call("/posts", { token: w.creator, body: { ...body, videoAssetId: open } })).json.error, "video_not_protected", "a public upload cannot be locked");
  const post = await w.call("/posts", { token: w.creator, body: { ...body, videoAssetId: locked, previewSeconds: 9999 } });
  assert.equal(post.status, 201, post.text);
  assert.equal(post.json.post.previewSeconds, 60, "the preview is capped by the admin setting");
  assert.equal(post.json.post.media.videoAssetId, post.json.post.isMine ? locked : null);

  const id = post.json.post.id as string;
  const anon = await w.call(`/posts/${id}/playback`);
  assert.equal(anon.status, 200);
  assert.equal(anon.json.preview, true);
  const expiry = new Date(anon.json.playback.expiresAt).getTime() - Date.now();
  assert.ok(expiry > 0 && expiry <= 90_000, "the preview address dies soon after the preview");
  assert.equal((await w.call(`/posts/${id}/playback`)).status, 403, "only one preview per viewer in the cool-off window");
  const strangerShell = (await w.call(`/posts/${id}`, { token: w.fan })).json.post;
  assert.equal(strangerShell.media.videoAssetId, null, "the video id is withheld from non-members");

  await w.fund("fan", 10_000);
  assert.equal((await w.call(`/tiers/${tier}/subscribe`, { token: w.fan })).status, 201);
  const full = await w.call(`/posts/${id}/playback`, { token: w.fan });
  assert.equal(full.json.preview, false);
  assert.ok(new Date(full.json.playback.expiresAt).getTime() - Date.now() > 600_000, "members get the normal address lifetime");
  assert.equal((await w.call(`/posts/${id}/playback`, { token: w.creator })).json.preview, false, "the owner always plays it");
  await w.configure(w.admin, { monetization: { maxPreviewSeconds: 0 } });
  assert.equal((await w.call(`/posts/${id}/playback`, { token: w.other })).status, 403, "with previews off a stranger gets nothing");
});

test("withdrawing: the only place verification is asked, and it is enforced", async () => {
  const w = await world();
  const ch = await openChannel(w);
  await w.configure(w.admin, { monetization: { enabled: true }, kyc: { payoutAccountCooldownDays: 0 } });
  const tier = (await w.call("/creator/tiers", { token: w.creator, body: { name: "Fan", priceUgx: 20_000 } })).json.id as string;
  await w.fund("fan", 100_000);
  await w.call(`/tiers/${tier}/subscribe`, { token: w.fan });
  await w.call(`/channels/${ch.id}/tip`, { token: w.fan, body: { amountUgx: 50_000 } });
  const earned = (await w.call("/creator/earnings", { token: w.creator })).json.availableUgx as number;
  assert.equal(earned, 17_000 + 45_000);

  // Withdrawals are off until the business is licensed.
  const off = await w.call("/creator/withdrawals", { token: w.creator, body: { amountUgx: 10_000, payoutAccountId: "x" } });
  assert.equal(off.json.error, "withdrawals_unavailable");
  // Earnings can still be spent inside Peebee, with no ID.
  const moved = await w.call("/creator/move-to-wallet", { token: w.creator, body: { amountUgx: 2_000 } });
  assert.equal(moved.json.walletBalanceUgx, 2_000);
  assert.equal((await w.call("/creator/move-to-wallet", { token: w.creator, body: { amountUgx: 9_999_999 } })).json.error, "insufficient_balance");

  await w.configure(w.admin, MONEY_ON);
  const acct = await w.call("/creator/payout-accounts", { token: w.creator, body: { msisdn: "0772123456", accountName: "Amina Nakato" } });
  assert.equal(acct.status, 201, acct.text);
  assert.equal((await w.call("/creator/payout-accounts", { token: w.creator, body: { msisdn: "12345", accountName: "Amina Nakato" } })).json.error, "invalid_number");
  const tryWithdraw = (amountUgx: number) => w.call("/creator/withdrawals", { token: w.creator, body: { amountUgx, payoutAccountId: acct.json.account.id } });
  const blocked = await tryWithdraw(10_000);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, "kyc_required");
  assert.equal(blocked.json.kycStatus, "none");
  assert.equal((await w.call("/creator/withdrawals", { token: w.creator })).json.availableUgx, earned - 2_000, "the balance is untouched");

  // Submit the verification.
  const front = (await w.call("/creator/kyc/documents", { token: w.creator, form: w.picture("front.png") })).json.key as string;
  const selfie = (await w.call("/creator/kyc/documents", { token: w.creator, form: w.picture("me.png") })).json.key as string;
  const kycBody = { fullName: "Amina Nakato", idType: "national_id", idNumber: "CM90012345ABCD", dateOfBirth: "1992-04-02", idFrontKey: front, selfieKey: selfie };
  assert.equal((await w.call("/creator/kyc", { token: w.creator, body: { ...kycBody, dateOfBirth: new Date(Date.now() - 16 * 365 * 86_400_000).toISOString().slice(0, 10) } })).json.error, "underage");
  assert.equal((await w.call("/creator/kyc", { token: w.creator, body: { ...kycBody, idFrontKey: "kyc/someone-else/doc.png" } })).json.error, "front_required", "cannot use another person's document");
  assert.equal((await w.call("/creator/kyc", { token: w.creator, body: { ...kycBody, selfieKey: undefined } })).json.error, "selfie_required");
  const sent = await w.call("/creator/kyc", { token: w.creator, body: kycBody });
  assert.equal(sent.status, 201, sent.text);
  assert.equal(sent.json.status, "pending");
  assert.ok(!JSON.stringify(sent.json).includes("CM90012345ABCD"), "the ID number is masked");
  assert.equal((await tryWithdraw(10_000)).json.kycStatus, "pending");

  // Staff review. Only staff can see the documents.
  assert.equal((await w.call("/admin/channels/kyc", { token: w.creator })).status, 403);
  const queue = await w.call("/admin/channels/kyc", { token: w.admin });
  assert.equal(queue.json.checks.length, 1);
  const detail = await w.call("/admin/channels/kyc/creator", { token: w.admin });
  assert.equal(detail.json.idNumber, "CM90012345ABCD");
  const photo = await (await import("../app.js")).default.request("/v1/admin/channels/kyc/creator/document/front", { headers: { Authorization: `Bearer ${w.admin}` } });
  assert.equal(photo.status, 200);
  assert.equal((await w.call("/admin/channels/kyc/creator/review", { method: "POST", token: w.admin, body: { decision: "reject" } })).json.error, "reason_required");
  assert.equal((await w.call("/admin/channels/kyc/creator/review", { method: "POST", token: w.admin, body: { decision: "reject", notes: "Photo is blurry" } })).status, 200);
  const rejected = await w.call("/creator/kyc", { token: w.creator });
  assert.equal(rejected.json.status, "rejected");
  assert.equal(rejected.json.reviewNotes, "Photo is blurry");
  assert.equal((await w.call("/creator/kyc", { token: w.creator, body: kycBody })).status, 201, "they can fix it and resubmit");
  assert.equal((await w.call("/admin/channels/kyc/creator/review", { method: "POST", token: w.admin, body: { decision: "approve" } })).status, 200);

  // Limits and name checks apply to an approved person too.
  assert.equal((await tryWithdraw(1_000)).json.error, "below_minimum");
  assert.equal((await tryWithdraw(60_000_000)).json.error, "above_maximum");
  const stranger = await w.call("/creator/payout-accounts", { token: w.creator, body: { msisdn: "0752111222", accountName: "Someone Else" } });
  assert.equal((await w.call("/creator/withdrawals", { token: w.creator, body: { amountUgx: 10_000, payoutAccountId: stranger.json.account.id } })).json.error, "name_mismatch");
  assert.equal((await tryWithdraw(1_000_000)).json.error, "insufficient_balance");

  const ok = await tryWithdraw(10_000);
  assert.equal(ok.status, 201, ok.text);
  const afterOverview = await w.call("/creator/withdrawals", { token: w.creator });
  assert.equal(afterOverview.json.availableUgx, earned - 2_000 - 10_000, "the money left the balance at once");
  assert.equal(afterOverview.json.limits.withdrawnTodayUgx, 10_000);

  // The payout settles (or fails and the money comes back), exactly once.
  await w.client.execute("UPDATE creator_withdrawals SET created_at = datetime('now', '-1 minute')");
  const settled = await w.call(`/creator/withdrawals/${ok.json.withdrawalId}/refresh`, { method: "POST", token: w.creator });
  assert.ok(["successful", "failed"].includes(settled.json.status));
  const again = await w.call(`/creator/withdrawals/${ok.json.withdrawalId}/refresh`, { method: "POST", token: w.creator });
  assert.equal(again.json.status, settled.json.status);
  const balanceNow = (await w.call("/creator/withdrawals", { token: w.creator })).json.availableUgx as number;
  assert.equal(balanceNow, settled.json.status === "failed" ? earned - 2_000 : earned - 2_000 - 10_000, "a failed payout is returned exactly once");
  const sums = await w.client.execute("SELECT SUM(amount) AS s FROM ledger_entries");
  assert.equal(Number(sums.rows[0]!.s), 0);

  // Daily cap.
  await w.configure(w.admin, { kyc: { dailyCapUgx: 12_000 } });
  if (settled.json.status === "successful") assert.equal((await tryWithdraw(5_000)).json.error, "daily_cap");
});

test("causes: approval, public giving without an account, held funds, release and refunds", async () => {
  const w = await world();
  const ch = await openChannel(w);
  await w.configure(w.admin, { causes: { enabled: true, holdDays: 2 }, kyc: { withdrawalsEnabled: true, payoutAccountCooldownDays: 0 } });
  const mk = (body: Json = {}) => w.call("/creator/causes", { token: w.creator, body: { title: "Roof for the village school", story: "The school roof leaks and children study in the rain. We need to replace it before the season.", goalUgx: 1_000_000, days: 30, ...body } });
  assert.equal((await mk({ goalUgx: 5 })).json.error, "invalid_goal");
  assert.equal((await mk({ days: 999 })).json.error, "invalid_days");
  const cause = (await mk()).json.cause;
  assert.equal(cause.status, "draft");
  assert.equal((await w.call(`/public/causes/${cause.slug}`)).status, 404, "not public until approved");
  assert.equal((await w.call(`/public/causes/${cause.slug}/donate`, { body: { amountUgx: 5000, method: "momo", msisdn: "0772123456" } })).json.error, "not_accepting");
  assert.equal((await w.call(`/creator/causes/${cause.id}/submit`, { token: w.creator })).json.cause.status, "submitted");
  assert.equal((await w.call(`/admin/channels/causes/${cause.id}/review`, { method: "POST", token: w.creator, body: { decision: "approve" } })).status, 403);
  assert.equal((await w.call(`/admin/channels/causes/${cause.id}/review`, { method: "POST", token: w.admin, body: { decision: "reject" } })).json.error, "reason_required");
  assert.equal((await w.call(`/admin/channels/causes/${cause.id}/review`, { method: "POST", token: w.admin, body: { decision: "reject", reason: "Add proof of the damage" } })).status, 200);
  assert.equal((await w.call("/creator/causes", { token: w.creator })).json.causes[0].rejectionReason, "Add proof of the damage");
  await w.call(`/creator/causes/${cause.id}`, { method: "PATCH", token: w.creator, body: { story: "The school roof leaks badly. Here is a photo and a quote from the builder for the full replacement." } });
  await w.call(`/creator/causes/${cause.id}/submit`, { token: w.creator });
  assert.equal((await w.call(`/admin/channels/causes/${cause.id}/review`, { method: "POST", token: w.admin, body: { decision: "approve" } })).status, 200);

  // Anyone can open the page and give without an account.
  const page = await w.call(`/public/causes/${cause.slug}`);
  assert.equal(page.status, 200);
  assert.equal(page.json.cause.status, "live");
  assert.equal(page.json.cause.channel.handle, "amina");
  assert.equal((await w.call("/public/causes")).json.causes.length, 1);
  assert.equal((await w.call(`/public/causes/${cause.slug}/donate`, { body: { amountUgx: 10, method: "momo", msisdn: "0772123456" } })).json.error, "invalid_amount");
  assert.equal((await w.call(`/public/causes/${cause.slug}/donate`, { body: { amountUgx: 5000, method: "wallet" } })).json.error, "sign_in_required");
  assert.equal((await w.call(`/public/causes/${cause.slug}/donate`, { body: { amountUgx: 5000, method: "momo", msisdn: "123" } })).json.error, "invalid_number");

  async function giveAsGuest(amountUgx: number, extra: Json = {}) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const d = await w.call(`/public/causes/${cause.slug}/donate`, { body: { amountUgx, method: "momo", msisdn: "0772123456", ...extra } });
      assert.equal(d.status, 201, d.text);
      assert.equal(d.json.status, "pending");
      await w.client.execute({ sql: "UPDATE donations SET created_at = datetime('now', '-1 minute') WHERE code = ?", args: [d.json.code] });
      const r = await w.call(`/public/donations/${d.json.code}`);
      if (r.json.status === "successful") return d.json.code as string;
      assert.equal(r.json.status, "failed", "the simulated rails sometimes fail; retry");
    }
    throw new Error("could not complete a simulated donation");
  }
  const code = await giveAsGuest(100_000, { name: "Grace", tipUgx: 2_000, message: "God bless" });
  const anon = await giveAsGuest(50_000, { name: "Hidden Donor", anonymous: true });
  assert.equal((await w.call(`/public/donations/${code}`)).json.status, "successful");
  assert.equal((await w.call(`/public/donations/${code}`)).json.status, "successful", "polling again changes nothing");
  await w.fund("fan", 40_000);
  const walletGift = await w.call(`/public/causes/${cause.slug}/donate`, { token: w.fan, body: { amountUgx: 30_000, method: "wallet", name: "Joseph" } });
  assert.equal(walletGift.json.status, "successful");
  assert.equal(await w.wallet("fan"), 10_000);

  const after = (await w.call(`/public/causes/${cause.slug}`)).json.cause;
  assert.equal(after.raisedUgx, 180_000, "tips are not part of what was raised");
  assert.equal(after.donorCount, 3);
  assert.equal(after.percent, 18);
  assert.ok(after.donors.some((d: Json) => d.name === "Grace") && after.donors.some((d: Json) => d.name === "Anonymous") && !JSON.stringify(after).includes("Hidden Donor"));

  // Funds are held, then released only to a verified creator.
  const owner = (await w.call("/creator/causes", { token: w.creator })).json.causes[0];
  assert.equal(owner.releasableUgx, 0, "held for the fraud window");
  await w.client.execute("UPDATE donations SET created_at = datetime('now', '-3 days')");
  assert.equal((await w.call("/creator/causes", { token: w.creator })).json.causes[0].releasableUgx, 180_000);
  const noKyc = await w.call(`/creator/causes/${cause.id}/release`, { token: w.creator, body: {} });
  assert.equal(noKyc.json.error, "kyc_required");
  await w.client.execute({
    sql: `INSERT INTO creator_kyc (user_id, full_name, id_type, id_number, date_of_birth, id_front_key, status) VALUES ('creator', 'Amina Nakato', 'national_id', 'CM1234567', '1990-01-01', 'kyc/creator/x.png', 'approved')`,
    args: [],
  });
  assert.equal((await w.call(`/creator/causes/${cause.id}/release`, { token: w.creator, body: { amountUgx: 999_999 } })).json.error, "nothing_to_release");
  const rel = await w.call(`/creator/causes/${cause.id}/release`, { token: w.creator, body: { amountUgx: 100_000 } });
  assert.equal(rel.json.releasedUgx, 100_000);
  assert.equal((await w.call("/creator/earnings", { token: w.creator })).json.availableUgx, 100_000);
  assert.equal((await w.call("/creator/causes", { token: w.creator })).json.causes[0].releasableUgx, 80_000);

  const sums = await w.client.execute("SELECT SUM(amount) AS s FROM ledger_entries");
  assert.equal(Number(sums.rows[0]!.s), 0, "the books balance");
  const fees = await w.client.execute("SELECT COALESCE(SUM(e.amount), 0) AS b FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.purpose = 'channel_fees'");
  assert.equal(Number(fees.rows[0]!.b), 2_000, "only the donor's optional tip (the default donation cut is 0%)");

  // Freezing stops giving and releasing.
  assert.equal((await w.call(`/admin/channels/causes/${cause.id}/freeze`, { method: "POST", token: w.admin, body: { frozen: true } })).json.error, "reason_required");
  await w.call(`/admin/channels/causes/${cause.id}/freeze`, { method: "POST", token: w.admin, body: { frozen: true, reason: "Under review" } });
  assert.equal((await w.call(`/public/causes/${cause.slug}/donate`, { body: { amountUgx: 5000, method: "momo", msisdn: "0772123456" } })).json.error, "not_accepting");
  assert.equal((await w.call(`/creator/causes/${cause.id}/release`, { token: w.creator, body: {} })).json.error, "frozen");
  await w.call(`/admin/channels/causes/${cause.id}/freeze`, { method: "POST", token: w.admin, body: { frozen: false } });

  // A full refund returns every donor's money, wallet donors to their wallet.
  assert.equal((await w.call(`/admin/channels/causes/${cause.id}/refund-all`, { method: "POST", token: w.admin, body: { reason: "Fraud" } })).json.error, "already_released", "money already released cannot be refunded from here");
});

test("causes: all-or-nothing refunds everyone when the goal is missed; a large goal needs verification to go live", async () => {
  const w = await world();
  await openChannel(w);
  await w.configure(w.admin, { causes: { enabled: true, allowAllOrNothing: true, requireKycAboveGoalUgx: 2_000_000, holdDays: 0 } });
  const mk = (body: Json) => w.call("/creator/causes", { token: w.creator, body: { title: "Medical fund for a child", story: "A long story about why this fund matters and how the money will be used by the family.", days: 10, ...body } });
  const big = (await mk({ goalUgx: 5_000_000 })).json.cause;
  await w.call(`/creator/causes/${big.id}/submit`, { token: w.creator });
  const blocked = await w.call(`/admin/channels/causes/${big.id}/review`, { method: "POST", token: w.admin, body: { decision: "approve" } });
  assert.equal(blocked.json.error, "kyc_required_for_goal", "a large goal needs a verified creator before it can go live");

  const small = (await mk({ goalUgx: 500_000, fundingMode: "all_or_nothing" })).json.cause;
  assert.equal(small.fundingMode, "all_or_nothing");
  await w.call(`/creator/causes/${small.id}/submit`, { token: w.creator });
  await w.call(`/admin/channels/causes/${small.id}/review`, { method: "POST", token: w.admin, body: { decision: "approve" } });
  await w.fund("fan", 100_000);
  assert.equal((await w.call(`/public/causes/${small.slug}/donate`, { token: w.fan, body: { amountUgx: 60_000, tipUgx: 1_000, method: "wallet" } })).json.status, "successful");
  assert.equal(await w.wallet("fan"), 39_000);
  assert.equal((await w.call(`/creator/causes/${small.id}/release`, { token: w.creator, body: {} })).json.error, "kyc_required");

  await w.client.execute({ sql: "UPDATE causes SET ends_at = datetime('now', '-1 minute') WHERE id = ?", args: [small.id] });
  const { sweepCauses } = await import("./causes.js");
  assert.equal((await sweepCauses()).ended, 1);
  assert.equal(await w.wallet("fan"), 100_000, "the whole payment, tip included, went back to the donor's wallet");
  const after = (await w.call(`/public/causes/${small.slug}`)).json.cause;
  assert.equal(after.status, "ended");
  assert.equal(after.raisedUgx, 0);
  const sums = await w.client.execute("SELECT SUM(amount) AS s FROM ledger_entries");
  assert.equal(Number(sums.rows[0]!.s), 0);
  const escrow = await w.client.execute("SELECT COALESCE(SUM(e.amount), 0) AS b FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.purpose LIKE 'cause_escrow:%'");
  assert.equal(Number(escrow.rows[0]!.b), 0, "nothing is left held for a refunded cause");
});

test("rewards: counted views earn points, the dated rate decides their worth, cash-out is capped", async () => {
  const w = await world();
  const ch = await openChannel(w);
  await w.configure(w.admin, { rewards: { enabled: true, minCashoutPoints: 10, cashoutCooldownDays: 0, qualifiedViewSeconds: 3 } });
  const post = (await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "Watch this", publish: true } })).json.post.id as string;

  const view = (token: string | undefined, seconds: number) => w.call(`/posts/${post}/view`, { token, body: { seconds } });
  assert.equal((await view(w.fan, 1)).json.qualified, false, "too short to count");
  assert.equal((await view(w.fan, 5)).json.qualified, true, "watched long enough on the same day still earns once");
  assert.equal((await view(w.fan, 9)).json.qualified, false, "no second reward the same day");
  assert.equal((await view(w.creator, 30)).json.counted, false, "own views earn nothing");
  assert.equal((await view(undefined, 30)).json.qualified, false, "anonymous views are off by default");
  assert.equal((await w.call(`/posts/${post}`)).json.post.counts.views, 2, "distinct viewer-days: the fan and the anonymous visitor (who earn the creator nothing)");

  let r = await w.call("/creator/rewards", { token: w.creator });
  assert.equal(r.json.points, 1);
  // Enough viewers to cash out, earned while a first rate is in force.
  await w.call("/admin/channels/rates", { token: w.admin, body: { effectiveFrom: "2000-01-01T00:00:00Z", ugxPer1000Points: 2_000, note: "Launch rate" } });
  for (let i = 0; i < 12; i++) await view(await w.mkUser(`v${i}`), 10);
  r = await w.call("/creator/rewards", { token: w.creator });
  assert.equal(r.json.points, 13);
  // The rate rises later; points already earned keep the rate they were earned at (the default).
  await w.call("/admin/channels/rates", { token: w.admin, body: { effectiveFrom: "2000-02-01T00:00:00Z", ugxPer1000Points: 4_000 } });
  assert.equal((await w.call("/admin/channels/rates", { token: w.admin })).json.currentUgxPer1000, 4_000);
  for (let i = 0; i < 12; i++) await view(await w.mkUser(`w${i}`), 10);
  r = await w.call("/creator/rewards", { token: w.creator });
  assert.equal(r.json.points, 25);
  // The first point was earned before any rate existed, so it is worth nothing; 12 at 2,000 and 12 at 4,000 per 1,000: 24 + 48.
  assert.equal(r.json.estimatedValueUgx, 72);

  assert.equal((await w.call("/creator/rewards/cashout", { token: w.creator, body: { points: 5 } })).json.error, "below_minimum");
  const cash = await w.call("/creator/rewards/cashout", { token: w.creator, body: {} });
  assert.equal(cash.status, 200, cash.text);
  assert.equal(cash.json.paidUgx, 72);
  assert.equal((await w.call("/creator/earnings", { token: w.creator })).json.availableUgx, 72);

  // Switching to "the rate on the day" values the next batch at the current rate.
  await w.configure(w.admin, { rewards: { rateLock: "at_cashout" } });
  for (let i = 0; i < 12; i++) await view(await w.mkUser(`x${i}`), 10);
  assert.equal((await w.call("/creator/rewards", { token: w.creator })).json.estimatedValueUgx, 48, "12 points at 4,000 per 1,000");

  // A monthly budget scales payouts down instead of failing them.
  await w.configure(w.admin, { rewards: { monthlyBudgetUgx: 100 } });
  const scaled = await w.call("/creator/rewards/cashout", { token: w.creator, body: {} });
  assert.equal(scaled.json.paidUgx, 28, "only what is left of the 100 UGX budget (72 already paid)");
  assert.equal(scaled.json.scalePercent, 58);
  assert.equal((await w.call("/creator/rewards/cashout", { token: w.creator, body: {} })).json.error, "below_minimum", "the points were used");

  // Rewards switch off completely.
  await w.configure(w.admin, { rewards: { enabled: false } });
  assert.equal((await w.call("/creator/rewards/cashout", { token: w.creator, body: {} })).json.error, "rewards_unavailable");
});

test("rewards: a creator's share of ad revenue lands in their earnings once", async () => {
  const w = await world();
  await openChannel(w);
  await w.client.execute({ sql: `INSERT INTO ad_campaigns (id, advertiser_name, name, status, environment) VALUES ('cmp1', 'A', 'N', 'active', 'sandbox')`, args: [] });
  await w.client.execute({ sql: `INSERT INTO ad_creatives (id, campaign_id, media_url, status) VALUES ('crv1', 'cmp1', 'https://ads.example.com/a.mp4', 'approved')`, args: [] });
  for (let i = 0; i < 3; i++) {
    await w.client.execute({
      sql: `INSERT INTO ad_events (id, serve_id, event, campaign_id, creative_id, creator_id, viewer_key, cost_milli, creator_share_milli, environment) VALUES (?, ?, 'impression', 'cmp1', 'crv1', 'creator', 'v', 5000, 2750, 'sandbox')`,
      args: [`evt${i}`, `srv${i}`],
    });
  }
  const first = await w.call("/creator/earnings", { token: w.creator });
  assert.equal(first.json.availableUgx, 8, "8,250 thousandths of a shilling, paid as 8 UGX");
  const second = await w.call("/creator/earnings", { token: w.creator });
  assert.equal(second.json.availableUgx, 8, "never credited twice");
  assert.equal(second.json.recent[0].kind, "ad_share");
  await w.configure(w.admin, { rewards: { adShareEnabled: false } });
  await w.client.execute({ sql: `INSERT INTO ad_events (id, serve_id, event, campaign_id, creative_id, creator_id, viewer_key, cost_milli, creator_share_milli, environment) VALUES ('evt9', 'srv9', 'impression', 'cmp1', 'crv1', 'creator', 'v', 9000000, 5000000, 'sandbox')`, args: [] });
  assert.equal((await w.call("/creator/earnings", { token: w.creator })).json.availableUgx, 8, "the admin can switch the ad share off");
});

test("admin: overview, channel controls and the activity log", async () => {
  const w = await world();
  const ch = await openChannel(w);
  const overview = await w.call("/admin/channels", { token: w.admin });
  assert.equal(overview.json.migrationApplied, true);
  assert.equal(overview.json.stats.channels, 1);
  assert.equal((await w.call("/admin/channels", { token: w.creator })).status, 403);
  const list = await w.call("/admin/channels/list?q=amin", { token: w.admin });
  assert.equal(list.json.channels[0].ownerName, "Amina Nakato");

  assert.equal((await w.call(`/admin/channels/${ch.id}/status`, { method: "POST", token: w.admin, body: { status: "suspended" } })).json.error, "reason_required");
  await w.call(`/admin/channels/${ch.id}/status`, { method: "POST", token: w.admin, body: { status: "suspended", reason: "Impersonation" } });
  assert.equal((await w.call("/public/channels/amina")).status, 404, "a suspended channel disappears");
  assert.equal((await w.call("/posts", { token: w.creator, body: { publisherType: "channel", publisherId: ch.id, type: "text", caption: "x", publish: true } })).json.error, "not_your_identity");
  await w.call(`/admin/channels/${ch.id}/status`, { method: "POST", token: w.admin, body: { status: "active" } });
  await w.call(`/admin/channels/${ch.id}/badge`, { method: "POST", token: w.admin, body: { verified: true } });
  assert.equal((await w.call("/public/channels/amina")).json.channel.verified, true);
  const log = await w.client.execute("SELECT action FROM admin_activity_log WHERE action LIKE 'channels.%'");
  const actions = log.rows.map((r) => String(r.action));
  for (const a of ["channels.config.update", "channels.channel.suspended", "channels.channel.active", "channels.channel.badge"]) assert.ok(actions.includes(a), a);
});
