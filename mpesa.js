const axios = require("axios");
const base = () => process.env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

async function token() {
  const auth = Buffer.from(process.env.MPESA_CONSUMER_KEY + ":" + process.env.MPESA_CONSUMER_SECRET).toString("base64");
  const r = await axios.get(base() + "/oauth/v1/generate?grant_type=client_credentials", { headers: { Authorization: "Basic " + auth } });
  return r.data.access_token;
}
const stamp = () => new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

async function stkPush({ phone, amount, orderNo }) {
  const ts = stamp(), shortcode = process.env.MPESA_SHORTCODE;
  const password = Buffer.from(shortcode + process.env.MPESA_PASSKEY + ts).toString("base64");
  const r = await axios.post(base() + "/mpesa/stkpush/v1/processrequest", {
    BusinessShortCode: shortcode, Password: password, Timestamp: ts,
    TransactionType: process.env.MPESA_TXN_TYPE || "CustomerPayBillOnline",
    Amount: Math.round(amount), PartyA: phone, PartyB: shortcode, PhoneNumber: phone,
    CallBackURL: process.env.PUBLIC_URL + "/api/mpesa/callback/" + process.env.MPESA_CALLBACK_SECRET,
    AccountReference: orderNo, TransactionDesc: "LUMIERE order"
  }, { headers: { Authorization: "Bearer " + (await token()) } });
  return r.data;
}
module.exports = { stkPush };
