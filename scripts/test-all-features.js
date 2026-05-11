#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) {
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  }
} catch {}

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import Groq from "groq-sdk";
import crypto from "crypto";

const TEST_EMAIL = "shivrudra098@gmail.com";
const SHOP_DOMAIN = "floxo-test.myshopify.com";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });
const redis = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
const reviewQ = new Queue("review-request", { connection: redis });
const analyticsQ = new Queue("analytics", { connection: redis });
const results = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function run(n, fn) {
  console.log("\n===== " + n + " =====");
  try {
    const d = await fn();
    results.push({ n, ok: true });
    console.log("[PASS] " + n + (d ? "  " + d : ""));
  } catch (e) {
    results.push({ n, ok: false });
    console.log("[FAIL] " + n);
    console.log("  " + (e.message || String(e)));
  }
}

async function ensureShop() {
  let s = await db.shop.findUnique({ where: { shopDomain: SHOP_DOMAIN } });
  if (!s) s = await db.shop.create({ data: { shopDomain: SHOP_DOMAIN, accessToken: "shpat_test_" + crypto.randomBytes(8).toString("hex"), plan: "PRO", isActive: true } });
  return s;
}
async function ensureCustomer(shopId) {
  const existing = await db.customer.findFirst({ where: { shopId, email: TEST_EMAIL } });
  if (existing) return existing;
  return await db.customer.create({ data: { shopId, shopifyId: "test-" + crypto.randomBytes(4).toString("hex"), email: TEST_EMAIL, firstName: "Test", lastName: "User", isSubscribed: true } });
}

async function testReviews() {
  const shop = await ensureShop();
  const rr = await db.reviewRequest.create({ data: { shopId: shop.id, orderId: "TEST-" + Date.now(), customerEmail: TEST_EMAIL, status: "pending", scheduledAt: new Date() } });
  await reviewQ.add("review-request", { shopId: shop.id, orderId: rr.orderId, customerEmail: TEST_EMAIL, customerName: "Shiv", productTitle: "Nexify Test Product", shopName: "Floxo Test", reviewRequestId: rr.id }, { delay: 0 });
  const deadline = Date.now() + 30000;
  let final;
  while (Date.now() < deadline) {
    final = await db.reviewRequest.findUnique({ where: { id: rr.id } });
    if (final?.status === "sent") break;
    await sleep(2000);
  }
  if (final?.status !== "sent") throw new Error("status stuck at " + final?.status + " after 30s");
  return "email sent to " + TEST_EMAIL;
}

async function testFomo() {
  const appUrl = (process.env.SHOPIFY_APP_URL || "https://thenexify.app").replace(/\/+$/, "");
  const resp = await fetch(appUrl + "/socket.io/?EIO=4&transport=polling", { signal: AbortSignal.timeout(10000) });
  if (resp.status !== 200) throw new Error("socket.io returned " + resp.status);
  const body = await resp.text();
  if (!body.includes("sid")) throw new Error("handshake malformed");
  return "Socket.io OK at " + appUrl + "/socket.io/";
}

async function testLoyalty() {
  const shop = await ensureShop();
  const prog = await db.loyaltyProgram.upsert({ where: { shopId: shop.id }, update: { isActive: true }, create: { shopId: shop.id, isActive: true, pointsPerDollar: 1, pointsForSignup: 100, pointsForReview: 50, pointsForReferral: 200, rewardValue: 0.01 } });
  const cust = await ensureCustomer(shop.id);
  const initial = cust.loyaltyPoints;
  const [, c1] = await db.$transaction([
    db.loyaltyTransaction.create({ data: { shopId: shop.id, customerId: cust.id, programId: prog.id, type: "earn", points: 100, reason: "Test $100", orderId: "TEST-" + Date.now() } }),
    db.customer.update({ where: { id: cust.id }, data: { loyaltyPoints: { increment: 100 } } }),
  ]);
  if (c1.loyaltyPoints !== initial + 100) throw new Error("earn off: " + c1.loyaltyPoints);
  const [, c2] = await db.$transaction([
    db.loyaltyTransaction.create({ data: { shopId: shop.id, customerId: cust.id, programId: prog.id, type: "redeem", points: -50, reason: "Test redeem" } }),
    db.customer.update({ where: { id: cust.id }, data: { loyaltyPoints: { decrement: 50 } } }),
  ]);
  if (c2.loyaltyPoints !== initial + 50) throw new Error("redeem off: " + c2.loyaltyPoints);
  return initial + " -> " + c1.loyaltyPoints + " -> " + c2.loyaltyPoints;
}

async function testEmailCampaign() {
  const shop = await ensureShop();
  const cust = await ensureCustomer(shop.id);
  const camp = await db.campaign.create({ data: { shopId: shop.id, name: "Test " + Date.now(), subject: "Nexify Test Campaign", templateJson: [{ type: "text", content: "Hi" }], templateHtml: '<html><body><h1>Nexify Test</h1><p>Brevo works.</p></body></html>', status: "draft", recipientCount: 1 } });
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: { name: process.env.BREVO_SENDER_NAME, email: process.env.BREVO_SENDER_EMAIL }, to: [{ email: TEST_EMAIL }], subject: camp.subject, htmlContent: camp.templateHtml }),
  });
  if (!resp.ok) throw new Error("Brevo " + resp.status + ": " + await resp.text());
  const data = await resp.json();
  await db.emailSend.create({ data: { shopId: shop.id, customerId: cust.id, campaignId: camp.id, toEmail: TEST_EMAIL, subject: camp.subject, status: "sent", brevoMessageId: data.messageId } });
  await db.campaign.update({ where: { id: camp.id }, data: { status: "sent", sentAt: new Date() } });
  return "messageId=" + data.messageId;
}

async function testReferral() {
  const shop = await ensureShop();
  const prog = await db.referralProgram.upsert({ where: { shopId: shop.id }, update: { isActive: true }, create: { shopId: shop.id, isActive: true, advocateReward: 10, friendDiscount: 15, rewardType: "discount" } });
  const advocate = await ensureCustomer(shop.id);
  const code = advocate.referralCode || crypto.randomBytes(4).toString("hex");
  if (!advocate.referralCode) await db.customer.update({ where: { id: advocate.id }, data: { referralCode: code } });
  const friendEmail = "friend-" + Date.now() + "@test.com";
  const ref = await db.referral.create({ data: { shopId: shop.id, programId: prog.id, referrerCustomerId: advocate.id, referredEmail: friendEmail, status: "pending" } });
  const friend = await db.customer.create({ data: { shopId: shop.id, shopifyId: "f-" + crypto.randomBytes(4).toString("hex"), email: friendEmail, firstName: "Friend", isSubscribed: true, referredBy: code } });
  await db.referral.update({ where: { id: ref.id }, data: { status: "signed_up", referredCustomerId: friend.id } });
  const dc = "REF-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  await db.referral.update({ where: { id: ref.id }, data: { status: "purchased", discountCode: dc, orderId: "REF-" + Date.now() } });
  await db.customer.delete({ where: { id: friend.id } });
  await db.referral.delete({ where: { id: ref.id } });
  return "code=" + code + ", discount=" + dc;
}

async function testSeo() {
  const shop = await ensureShop();
  const settings = await db.seoSettings.upsert({ where: { shopId: shop.id }, update: {}, create: { shopId: shop.id, autoMetaTags: true, autoAltText: true, autoSchema: true } });
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const resp = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: 'Return ONLY JSON: {"metaTitle":"...","metaDescription":"..."}' },
      { role: "user", content: "Product: Premium Wireless Headphones with ANC" },
    ],
    max_tokens: 150,
    temperature: 0.3,
  });
  const txt = resp.choices[0]?.message?.content?.trim() || "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("non-JSON: " + txt.slice(0, 80));
  const parsed = JSON.parse(m[0]);
  if (!parsed.metaTitle) throw new Error("missing fields");
  await db.seoIssue.create({ data: { shopId: shop.id, settingsId: settings.id, type: "missing_meta", severity: "medium", resourceUrl: "/products/test", description: "Test" } });
  return "Groq OK: " + parsed.metaTitle.slice(0, 40);
}

async function testAnalytics() {
  const shop = await ensureShop();
  const sid = "t-" + Date.now();
  const events = [];
  for (let i = 0; i < 5; i++) events.push({ shopId: shop.id, sessionId: sid + "-" + i, visitorId: "v-" + (i % 3), eventType: "page_view", source: "google", medium: "organic" });
  for (let i = 0; i < 3; i++) events.push({ shopId: shop.id, sessionId: sid + "-" + i, visitorId: "v-" + (i % 3), eventType: "add_to_cart", productId: "p-" + i, source: "google", medium: "organic" });
  for (let i = 0; i < 2; i++) events.push({ shopId: shop.id, sessionId: sid + "-" + i, visitorId: "v-" + (i % 3), eventType: "purchase", orderId: "o-" + Date.now() + "-" + i, revenue: 99.99, source: "google", medium: "organic" });
  await db.analyticsEvent.createMany({ data: events });
  const counts = await db.analyticsEvent.groupBy({ by: ["eventType"], where: { shopId: shop.id, sessionId: { startsWith: sid } }, _count: true });
  const funnel = counts.map(c => c.eventType + "=" + c._count).join(", ");
  await analyticsQ.add("aggregate-day", { shopId: shop.id, date: new Date().toISOString().slice(0, 10) });
  return "funnel: " + funnel;
}

async function testUpsell() {
  const shop = await ensureShop();
  const up = await db.upsell.create({ data: { shopId: shop.id, type: "cart", productId: "test-p", title: "Test Upsell", discountPercent: 10, isActive: true } });
  await db.upsell.update({ where: { id: up.id }, data: { impressions: { increment: 100 } } });
  await db.upsell.update({ where: { id: up.id }, data: { conversions: { increment: 8 }, revenue: { increment: 200 } } });
  const f = await db.upsell.findUnique({ where: { id: up.id } });
  if (f.impressions !== 100 || f.conversions !== 8 || f.revenue !== 200) throw new Error("counters off");
  await db.upsell.delete({ where: { id: up.id } });
  return "100 imp, 8 conv, $200 rev, " + ((f.conversions / f.impressions) * 100).toFixed(1) + "% CR";
}

async function cleanup() {
  const shop = await db.shop.findUnique({ where: { shopDomain: SHOP_DOMAIN } });
  if (!shop) return console.log("no shop");
  await db.analyticsEvent.deleteMany({ where: { shopId: shop.id } });
  await db.loyaltyTransaction.deleteMany({ where: { shopId: shop.id } });
  await db.emailSend.deleteMany({ where: { shopId: shop.id } });
  await db.reviewRequest.deleteMany({ where: { shopId: shop.id } });
  await db.referral.deleteMany({ where: { shopId: shop.id } });
  await db.campaign.deleteMany({ where: { shopId: shop.id } });
  await db.upsell.deleteMany({ where: { shopId: shop.id } });
  await db.seoIssue.deleteMany({ where: { shopId: shop.id } });
  await db.customer.deleteMany({ where: { shopId: shop.id } });
  await db.seoSettings.deleteMany({ where: { shopId: shop.id } });
  await db.loyaltyProgram.deleteMany({ where: { shopId: shop.id } });
  await db.referralProgram.deleteMany({ where: { shopId: shop.id } });
  console.log("cleaned");
}

async function shutdown() {
  try { await reviewQ.close(); await analyticsQ.close(); await redis.quit(); await db.$disconnect(); await pool.end(); } catch {}
}

async function main() {
  if (process.argv.includes("--cleanup")) { await cleanup(); await shutdown(); return; }
  console.log("\n========== NEXIFY FEATURE TEST ==========");
  console.log("email: " + TEST_EMAIL + "  shop: " + SHOP_DOMAIN);
  await run("1. REVIEWS", testReviews);
  await run("2. FOMO", testFomo);
  await run("3. LOYALTY", testLoyalty);
  await run("4. EMAIL CAMPAIGN", testEmailCampaign);
  await run("5. REFERRAL", testReferral);
  await run("6. SEO", testSeo);
  await run("7. ANALYTICS", testAnalytics);
  await run("8. UPSELL", testUpsell);
  const p = results.filter(r => r.ok).length;
  console.log("\n========== SUMMARY ==========");
  for (const r of results) console.log((r.ok ? "[OK]" : "[XX]") + "  " + r.n);
  console.log("\n  " + p + "/8 passed\n");
  await shutdown();
  process.exit(p === 8 ? 0 : 1);
}

main().catch(async (e) => { console.error("FATAL:", e); await shutdown(); process.exit(1); });
