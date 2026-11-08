# LUMIÈRE Backend

Node.js, Express and MongoDB API with an admin dashboard and M-Pesa (Daraja) STK Push payments for the LUMIÈRE cosmetics storefront.

## Run it locally

```bash
npm install
cp .env.example .env     # then fill in the values
npm run seed             # loads the 10 products and creates your admin login
npm run dev              # http://localhost:4000  ·  admin: http://localhost:4000/admin
```

You need MongoDB running locally, or a free MongoDB Atlas connection string in `MONGODB_URI`.

## What it does

| Endpoint | Purpose |
|---|---|
| `GET /api/products` | Product list. Filters: `category`, `concern`, `q`, `minPrice`, `maxPrice`, `sort=lo\|hi` |
| `POST /api/orders` | Creates an order. Prices, discount and delivery are **recalculated on the server**; stock is checked |
| `POST /api/orders/:orderNo/pay` | Sends the M-Pesa STK Push prompt to the customer's phone |
| `POST /api/mpesa/callback/:secret` | Safaricom calls this when the customer pays or cancels. Marks the order paid and reduces stock |
| `GET /api/orders/:orderNo/status?phone=` | Order tracking (needs the order number and phone) |
| `POST /api/newsletter`, `POST /api/stock-alerts` | Email sign-ups and back-in-stock requests |
| `/api/admin/*` | Login, orders, products and stats (JWT protected). The dashboard is at `/admin` |

## M-Pesa setup

1. Create an app at [developer.safaricom.co.ke](https://developer.safaricom.co.ke) and copy the consumer key, secret, shortcode and passkey into `.env` (sandbox first).
2. Safaricom must reach your callback over **public HTTPS**. Deploy the API, or use a tunnel such as ngrok while testing, and set `PUBLIC_URL`.
3. Test in the sandbox, then apply for Go-Live with your real Paybill or Till and set `MPESA_ENV=production`.

## Connecting the storefront

Set `ALLOWED_ORIGIN` to your website's URL. The storefront then does:

```js
const order = await fetch(API + "/api/orders", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ customer: { name, phone, county, address }, items: [{ productId, shade, qty: 1 }], discountCode })
}).then(r => r.json());
await fetch(API + "/api/orders/" + order.orderNo + "/pay", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
```

`productId` values come from `GET /api/products`.

## Before you go live

- Use long random values for `JWT_SECRET` and `MPESA_CALLBACK_SECRET`, and a strong admin password.
- Set `ALLOWED_ORIGIN` to your real domain, not `*`.
- Keep `.env` out of Git (it is in `.gitignore`).
- Discount codes and delivery fees live at the top of `server.js` and must match the storefront.
- Deploy on Render, Railway or a VPS, with MongoDB Atlas for the database.
- Stock is reduced when payment is confirmed, so two people can briefly buy the last item. Add stock reservations if you expect heavy traffic.
