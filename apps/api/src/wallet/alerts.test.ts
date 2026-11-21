import assert from "node:assert/strict";
import test from "node:test";
import { alertSettingsFromValues, alertText, channelsFor, notifyMoneyMove, setMoneyAlertDeliveryForTests } from "./alerts.js";

test("money alert switches default on, except SMS", () => {
  const settings = alertSettingsFromValues({});
  assert.deepEqual(channelsFor(settings, "sent"), ["email", "chat", "notifications", "push"]);
  assert.deepEqual(channelsFor(settings, "received"), ["email", "chat", "notifications", "push"]);
  assert.equal(settings.sms.sent, false);
  assert.equal(settings.sms.received, false);
});

test("each money-alert switch is its own channel and event", () => {
  const settings = alertSettingsFromValues({
    wallet_alert_email_sent: "0",
    wallet_alert_sms_received: "1",
    wallet_alert_push_received: "0",
    wallet_alert_chat_sent: "0",
  });
  assert.deepEqual(channelsFor(settings, "sent"), ["notifications", "push"]);
  assert.deepEqual(channelsFor(settings, "received"), ["email", "sms", "chat", "notifications"]);
});

test("alert copy names the amount, the person, the account, and a reference", () => {
  const sent = alertText({
    event: "sent",
    amount: 12000,
    counterpartName: "Ada",
    accountName: "Main account",
    reference: "transfer:ben:key-1",
    at: "2026-11-17T14:02:00Z",
  });
  assert.equal(sent.title, "Money sent");
  assert.match(sent.body, /UGX 12,000/);
  assert.match(sent.body, /Ada/);
  assert.match(sent.body, /Main account/);
  assert.match(sent.body, /transfer:ben:key-1/);
  const received = alertText({
    event: "received",
    amount: 500,
    counterpartName: "Ben",
    accountName: "Home",
    reference: "tip_1",
    at: "2026-11-17T14:02:00Z",
    context: "Gift",
  });
  assert.equal(received.title, "Money received");
  assert.match(received.body, /Ben/);
  assert.match(received.body, /Home/);
  assert.match(received.body, /Gift/);
});

test("a throwing notifier does not reject the alert call", async () => {
  setMoneyAlertDeliveryForTests(async () => {
    throw new Error("notifier down");
  });
  try {
    await assert.doesNotReject(() => notifyMoneyMove({
      transferId: "transfer:ada:once",
      amount: 1000,
      fromUserId: "ada",
      toUserId: "ben",
    }));
  } finally {
    setMoneyAlertDeliveryForTests(null);
  }
});
