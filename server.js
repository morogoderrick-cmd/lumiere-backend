require("dotenv").config();
const path = require("path");
const express = require("express"), mongoose = require("mongoose"), cors = require("cors"), helmet = require("helmet");
const rateLimit = require("express-rate-limit"), jwt = require("jsonwebtoken"), bcrypt = require("bcryptjs");
const { Product, Order, Admin, Subscriber, StockAlert } = require("./models");
const mpesa = require("./mpesa");

for (const k of ["MONGODB_URI", "JWT_SECRET", "MPESA_CALLBACK_SECRET"]) if (!process.env[k]) { console.error("Missing env var " + k); process.exit(1); }

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: (process.env.ALLOWED_ORIGIN || "*").split(",").map(s => s.trim()) }));
app.use(express.json({ limit: "50kb" }));
app.use("/admin", express.static(path.join(__dirname, "admin")));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const limiter = (max, minutes = 15) => rateLimit({ windowMs: minutes * 60000, max, standardHeaders: true, legacyHeaders: false });
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

// Business rules (keep in sync with the storefront)
const DISCOUNTS = { WELCOME10: { rate: 0.1 }, LUMIERE15: { rate: 0.15, expires: "2026-11-30T23:59:59+03:00" } };
const deliveryFee = (county, raw) => raw >= 5000 ? 0 : (["Uasin Gishu", "Nairobi"].includes(county) ? 300 : 500);
const normPhone = p => { p = String(p || "").replace(/[\s+-]/g, ""); if (/^0[17]\d{8}$/.test(p)) p = "254" + p.slice(1); return /^254[17]\d{8}$/.test(p) ? p : null; };
const newOrderNo = () => "LUM-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
const isEmail = e => /^\S+@\S+\.\S+$/.test(String(e || ""));

app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------- Public: products ----------
app.get("/api/products", wrap(async (req, res) => {
  const { category, concern, q, minPrice, maxPrice, sort } = req.query, f = { active: true };
  if (category) f.category = String(category);
  if (concern) f.concerns = String(concern);
  if (q) f.name = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  if (minPrice || maxPrice) f.price = { ...(minPrice && { $gte: +minPrice }), ...(maxPrice && { $lte: +maxPrice }) };
  const order = { lo: { price: 1 }, hi: { price: -1 } }[sort] || { createdAt: 1 };
  res.json(await Product.find(f).sort(order).lean());
}));

// ---------- Public: create order (prices are ALWAYS recalculated here) ----------
app.post("/api/orders", limiter(20), wrap(async (req, res) => {
  const { customer = {}, items, discountCode, giftNote } = req.body || {};
  const phone = normPhone(customer.phone);
  const name = String(customer.name || "").trim().slice(0, 80);
  const address = String(customer.address || "").trim().slice(0, 200);
  const county = String(customer.county || "").trim().slice(0, 40);
  if (!name || !address || !phone) return res.status(400).json({ error: "Name, address and a valid M-Pesa phone number are required." });
  if (!Array.isArray(items) || !items.length || items.length > 30) return res.status(400).json({ error: "Your bag is empty or too large." });
  const ids = items.map(i => String(i.productId));
  if (ids.some(id => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: "Invalid product." });

  const prods = await Product.find({ _id: { $in: ids }, active: true });
  const byId = Object.fromEntries(prods.map(p => [String(p._id), p]));
  const need = {}, lines = []; let raw = 0;
  for (const i of items) {
    const p = byId[String(i.productId)], qty = Number.parseInt(i.qty, 10);
    if (!p || !(qty >= 1 && qty <= 10)) return res.status(400).json({ error: "Invalid item in your bag." });
    need[p.id] = (need[p.id] || 0) + qty;
    lines.push({ product: p._id, name: p.name, shade: String(i.shade || "").slice(0, 40), price: p.price, qty });
    raw += p.price * qty;
  }
  for (const id of Object.keys(need)) if (byId[id].stock < need[id]) return res.status(409).json({ error: byId[id].name + " does not have enough stock." });

  const code = String(discountCode || "").trim().toUpperCase(), d = DISCOUNTS[code];
  const valid = !!d && (!d.expires || new Date(d.expires) > new Date());
  const discount = valid ? Math.round(raw * d.rate) : 0, delivery = deliveryFee(county, raw);
  const order = await Order.create({
    orderNo: newOrderNo(), customer: { name, phone, county, address }, items: lines,
    giftNote: String(giftNote || "").slice(0, 120), subtotal: raw, discount, delivery,
    total: raw - discount + delivery, discountCode: valid ? code : undefined
  });
  res.status(201).json({ orderNo: order.orderNo, subtotal: raw, discount, delivery, total: order.total, discountApplied: valid ? code : null });
}));

// ---------- Public: start M-Pesa STK Push ----------
app.post("/api/orders/:orderNo/pay", limiter(10), wrap(async (req, res) => {
  const o = await Order.findOne({ orderNo: String(req.params.orderNo) });
  if (!o) return res.status(404).json({ error: "Order not found." });
  if (o.payment.status === "paid") return res.status(409).json({ error: "This order is already paid." });
  if (o.status === "cancelled") return res.status(409).json({ error: "This order was cancelled." });
  const phone = normPhone(req.body && req.body.phone) || o.customer.phone;
  try {
    const r = await mpesa.stkPush({ phone, amount: o.total, orderNo: o.orderNo });
    o.payment.status = "initiated"; o.payment.checkoutRequestId = r.CheckoutRequestID; await o.save();
    res.json({ message: "Check your phone and enter your M-Pesa PIN.", checkoutRequestId: r.CheckoutRequestID });
  } catch (e) {
    console.error("STK push failed:", e.response ? e.response.data : e.message);
    res.status(502).json({ error: "Could not start M-Pesa payment. Please try again." });
  }
}));

// ---------- Safaricom callback ----------
app.post("/api/mpesa/callback/:secret", wrap(async (req, res) => {
  if (req.params.secret !== process.env.MPESA_CALLBACK_SECRET) return res.sendStatus(403);
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  const cb = req.body && req.body.Body && req.body.Body.stkCallback;
  if (!cb) return;
  const o = await Order.findOne({ "payment.checkoutRequestId": cb.CheckoutRequestID });
  if (!o || o.payment.status === "paid") return;
  if (cb.ResultCode !== 0) { o.payment.status = "failed"; o.payment.failureReason = String(cb.ResultDesc || "").slice(0, 200); await o.save(); return; }
  const meta = Object.fromEntries(((cb.CallbackMetadata || {}).Item || []).map(i => [i.Name, i.Value]));
  if (Number(meta.Amount) < o.total) { o.payment.status = "failed"; o.payment.failureReason = "Amount mismatch"; await o.save(); return; }
  o.payment.status = "paid"; o.payment.receipt = String(meta.MpesaReceiptNumber || ""); o.status = "paid"; await o.save();
  for (const i of o.items) await Product.updateOne({ _id: i.product, stock: { $gte: i.qty } }, { $inc: { stock: -i.qty } });
}));

// ---------- Public: order tracking (needs the order number AND phone) ----------
app.get("/api/orders/:orderNo/status", limiter(60), wrap(async (req, res) => {
  const o = await Order.findOne({ orderNo: String(req.params.orderNo) }).lean();
  if (!o || o.customer.phone !== normPhone(req.query.phone)) return res.status(404).json({ error: "Order not found." });
  res.json({ orderNo: o.orderNo, status: o.status, payment: o.payment.status, total: o.total, items: o.items.map(i => ({ name: i.name, shade: i.shade, qty: i.qty })), updatedAt: o.updatedAt });
}));

// ---------- Public: newsletter and back-in-stock alerts ----------
app.post("/api/newsletter", limiter(10), wrap(async (req, res) => {
  const email = String((req.body || {}).email || "").toLowerCase();
  if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
  await Subscriber.updateOne({ email }, { email }, { upsert: true });
  res.json({ ok: true, code: "WELCOME10" });
}));
app.post("/api/stock-alerts", limiter(10), wrap(async (req, res) => {
  const { productId, email } = req.body || {};
  if (!mongoose.isValidObjectId(String(productId)) || !isEmail(email)) return res.status(400).json({ error: "Invalid request." });
  await StockAlert.create({ product: String(productId), email: String(email).toLowerCase() });
  res.json({ ok: true });
}));

// ---------- Admin ----------
app.post("/api/admin/login", limiter(8), wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const a = await Admin.findOne({ email: String(email || "").toLowerCase() });
  if (!a || !(await bcrypt.compare(String(password || ""), a.passwordHash))) return res.status(401).json({ error: "Invalid credentials" });
  res.json({ token: jwt.sign({ id: a._id }, process.env.JWT_SECRET, { expiresIn: "12h" }) });
}));

const admin = express.Router();
admin.use((req, res, next) => {
  try { req.admin = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Unauthorised" }); }
});
const FIELDS = ["name", "category", "description", "price", "stock", "shades", "image", "concerns", "active"];

admin.get("/stats", wrap(async (req, res) => {
  const [rev] = await Order.aggregate([{ $match: { "payment.status": "paid" } }, { $group: { _id: null, revenue: { $sum: "$total" }, orders: { $sum: 1 } } }]);
  const top = await Order.aggregate([{ $match: { "payment.status": "paid" } }, { $unwind: "$items" }, { $group: { _id: "$items.name", qty: { $sum: "$items.qty" } } }, { $sort: { qty: -1 } }, { $limit: 5 }]);
  res.json({
    revenue: rev ? rev.revenue : 0, paidOrders: rev ? rev.orders : 0,
    pending: await Order.countDocuments({ status: "pending" }), top,
    lowStock: await Product.find({ active: true, stock: { $lte: 3 } }).select("name stock").lean()
  });
}));
admin.get("/orders", wrap(async (req, res) => {
  const f = req.query.status ? { status: String(req.query.status) } : {};
  res.json(await Order.find(f).sort({ createdAt: -1 }).limit(200).lean());
}));
admin.patch("/orders/:id/status", wrap(async (req, res) => {
  const status = String((req.body || {}).status);
  if (!Order.schema.path("status").enumValues.includes(status)) return res.status(400).json({ error: "Invalid status" });
  const o = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
  o ? res.json(o) : res.status(404).json({ error: "Not found" });
}));
admin.get("/products", wrap(async (req, res) => res.json(await Product.find().sort({ createdAt: 1 }).lean())));
admin.post("/products", wrap(async (req, res) => res.status(201).json(await Product.create(pick(req.body || {}, FIELDS)))));
admin.put("/products/:id", wrap(async (req, res) => {
  const p = await Product.findByIdAndUpdate(req.params.id, { $set: pick(req.body || {}, FIELDS) }, { new: true, runValidators: true });
  p ? res.json(p) : res.status(404).json({ error: "Not found" });
}));
admin.delete("/products/:id", wrap(async (req, res) => { await Product.findByIdAndUpdate(req.params.id, { active: false }); res.json({ ok: true }); }));
app.use("/api/admin", admin);

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.name === "ValidationError" || err.name === "CastError") return res.status(400).json({ error: err.message });
  console.error(err); res.status(500).json({ error: "Something went wrong." });
});

const PORT = process.env.PORT || 4000;
mongoose.connect(process.env.MONGODB_URI)
  .then(() => app.listen(PORT, () => console.log("LUMIÈRE API running on port " + PORT + " · admin at /admin")))
  .catch(e => { console.error("MongoDB connection failed:", e.message); process.exit(1); });
