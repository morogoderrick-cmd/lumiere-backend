const mongoose = require("mongoose");
const { Schema } = mongoose;

const Product = mongoose.model("Product", new Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: ["skin", "lips", "face", "eyes"], required: true },
  description: String,
  price: { type: Number, required: true, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  shades: [{ name: String, hex: String }],
  image: String,
  concerns: [String],
  active: { type: Boolean, default: true }
}, { timestamps: true }));

const Order = mongoose.model("Order", new Schema({
  orderNo: { type: String, unique: true, index: true },
  customer: { name: String, phone: String, county: String, address: String },
  items: [{ product: { type: Schema.Types.ObjectId, ref: "Product" }, name: String, shade: String, price: Number, qty: Number }],
  giftNote: String,
  subtotal: Number, discount: Number, delivery: Number, total: Number, discountCode: String,
  status: { type: String, enum: ["pending", "paid", "packed", "shipped", "delivered", "cancelled"], default: "pending" },
  payment: {
    method: { type: String, default: "mpesa" },
    status: { type: String, enum: ["unpaid", "initiated", "paid", "failed"], default: "unpaid" },
    checkoutRequestId: { type: String, index: true },
    receipt: String,
    failureReason: String
  }
}, { timestamps: true }));

const Admin = mongoose.model("Admin", new Schema({
  email: { type: String, unique: true, lowercase: true, required: true },
  passwordHash: { type: String, required: true }
}, { timestamps: true }));

const Subscriber = mongoose.model("Subscriber", new Schema({ email: { type: String, unique: true, lowercase: true } }, { timestamps: true }));
const StockAlert = mongoose.model("StockAlert", new Schema({ product: { type: Schema.Types.ObjectId, ref: "Product" }, email: String }, { timestamps: true }));

module.exports = { Product, Order, Admin, Subscriber, StockAlert };
