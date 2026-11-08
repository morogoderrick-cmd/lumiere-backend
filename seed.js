require("dotenv").config();
const mongoose = require("mongoose"), bcrypt = require("bcryptjs");
const { Product, Admin } = require("./models");
const S = a => a.map(([name, hex]) => ({ name, hex }));
const lips = S([["Rosewood", "#c04a5e"], ["Nude", "#b57a6a"], ["Plum", "#7b2c55"], ["Coral", "#e0705a"]]);
const face = S([["Fair", "#f0d2b8"], ["Medium", "#c99572"], ["Tan", "#a06b48"], ["Deep", "#5e3a28"], ["Ebony", "#3a2218"]]);
const eyes = S([["Noir", "#222"], ["Bronze", "#8a5a2b"], ["Plum", "#6b4f7a"]]);
const size = S([["30ml"], ["50ml"]]);
const products = [
  { name: "Velvet Matte Lipstick", category: "lips", price: 2400, stock: 12, shades: lips, description: "Rich, weightless colour in Rosewood", concerns: [] },
  { name: "Golden Hour Serum", category: "skin", price: 4800, stock: 3, shades: size, description: "Vitamin C and rosehip for luminous skin", concerns: ["Glow"] },
  { name: "Silk Skin Foundation", category: "face", price: 3600, stock: 20, shades: face, description: "Medium coverage, 40 inclusive shades", concerns: [] },
  { name: "Noir Lash Mascara", category: "eyes", price: 2200, stock: 0, shades: eyes, description: "Volume and length, smudge-proof", concerns: [] },
  { name: "Rose Petal Cream", category: "skin", price: 3900, stock: 7, shades: size, description: "Deep hydration with shea and marula", concerns: ["Hydration", "Sensitive skin"] },
  { name: "Bronze Glow Highlighter", category: "face", price: 2900, stock: 2, shades: face, description: "Liquid light for cheekbones", concerns: ["Glow"] },
  { name: "Berry Kiss Lip Oil", category: "lips", price: 1900, stock: 15, shades: lips, description: "Glossy shine with nourishing oils", concerns: ["Hydration"] },
  { name: "Smoky Eye Palette", category: "eyes", price: 5200, stock: 4, shades: eyes, description: "Twelve rich, blendable shades", concerns: [] },
  { name: "Cloud Gel Cleanser", category: "skin", price: 2600, stock: 30, shades: size, description: "Gentle daily cleanse that never strips", concerns: ["Sensitive skin"] },
  { name: "Sheer Shield SPF 50", category: "skin", price: 3200, stock: 9, shades: size, description: "Invisible, weightless sun protection", concerns: ["Sun protection"] }
];
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  if (!(await Product.countDocuments())) { await Product.insertMany(products); console.log("Seeded " + products.length + " products"); }
  const { ADMIN_EMAIL: e, ADMIN_PASSWORD: p } = process.env;
  if (e && p && p.length >= 10) {
    await Admin.updateOne({ email: e.toLowerCase() }, { email: e.toLowerCase(), passwordHash: await bcrypt.hash(p, 12) }, { upsert: true });
    console.log("Admin account ready: " + e);
  } else console.log("Set ADMIN_EMAIL and a 10+ character ADMIN_PASSWORD in .env to create the admin login.");
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
