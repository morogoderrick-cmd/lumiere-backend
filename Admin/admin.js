const $ = s => document.querySelector(s);
let T = sessionStorage.getItem("t");
const kes = n => "KES " + Number(n || 0).toLocaleString("en-KE");
const ST = ["pending", "paid", "packed", "shipped", "delivered", "cancelled"];

function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  [].concat(kids).forEach(c => e.append(c));
  return e;
}
const go = fn => async () => { try { await fn(); } catch (e) { if (e.message !== "auth") alert(e.message); } };

async function api(path, opts = {}) {
  const r = await fetch("/api/admin" + path, { method: opts.method || "GET", headers: { "Content-Type": "application/json", Authorization: "Bearer " + T }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401) { logout(); throw new Error("auth"); }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}
function logout() { sessionStorage.removeItem("t"); T = null; $("#app").hidden = true; $("#login").hidden = false; }

async function stats() {
  const s = await api("/stats");
  $("#stats").replaceChildren(...[["Revenue", kes(s.revenue)], ["Paid orders", s.paidOrders], ["Pending", s.pending], ["Low stock", s.lowStock.map(p => p.name + " (" + p.stock + ")").join(", ") || "None"]]
    .map(([a, b]) => el("div", { class: "stat" }, [el("small", { text: a }), el("b", { text: String(b), style: String(b).length > 14 ? "font-size:1rem" : "" })])));
}
function statusSelect(o) {
  const s = el("select", { onchange: go(async () => { await api("/orders/" + o._id + "/status", { method: "PATCH", body: { status: s.value } }); stats(); }) }, ST.map(x => el("option", { value: x, text: x })));
  s.value = o.status; return s;
}
async function orders() {
  const list = await api("/orders");
  $("#orders").replaceChildren(...list.map(o => el("tr", {}, [
    el("td", { text: o.orderNo }),
    el("td", { text: o.customer.name + " · " + o.customer.phone + " · " + o.customer.county + " · " + o.customer.address }),
    el("td", { text: o.items.map(i => i.qty + "× " + i.name + (i.shade ? " (" + i.shade + ")" : "")).join(", ") + (o.giftNote ? " · Gift: " + o.giftNote : "") }),
    el("td", { text: kes(o.total) }),
    el("td", { text: o.payment.status + (o.payment.receipt ? " · " + o.payment.receipt : "") }),
    el("td", {}, [statusSelect(o)])
  ])));
}
async function products() {
  const list = await api("/products");
  $("#products").replaceChildren(...list.map(p => {
    const pr = el("input", { type: "number", min: 0, value: p.price }), st = el("input", { type: "number", min: 0, value: p.stock });
    return el("tr", {}, [
      el("td", { text: p.name + (p.active ? "" : " (hidden)") }), el("td", { text: p.category }),
      el("td", {}, [pr]), el("td", {}, [st]),
      el("td", {}, [
        el("button", { text: "Save", onclick: go(async () => { await api("/products/" + p._id, { method: "PUT", body: { price: +pr.value, stock: +st.value } }); stats(); }) }),
        el("button", { text: p.active ? "Hide" : "Show", onclick: go(async () => { await api("/products/" + p._id, { method: "PUT", body: { active: !p.active } }); products(); }) })
      ])
    ]);
  }));
}
function tab(n) { $("#v1").hidden = n !== 1; $("#v2").hidden = n !== 2; $("#t1").classList.toggle("on", n === 1); $("#t2").classList.toggle("on", n === 2); }
async function load() { $("#login").hidden = true; $("#app").hidden = false; await Promise.all([stats(), orders(), products()]); }

$("#t1").onclick = () => tab(1); $("#t2").onclick = () => tab(2); $("#out").onclick = logout;
$("#lf").onsubmit = async e => {
  e.preventDefault(); $("#le").textContent = "";
  const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("#em").value, password: $("#pw").value }) });
  const d = await r.json();
  if (!r.ok) { $("#le").textContent = d.error || "Sign-in failed"; return; }
  T = d.token; sessionStorage.setItem("t", T); $("#pw").value = ""; go(load)();
};
$("#af").onsubmit = e => { e.preventDefault(); go(async () => { await api("/products", { method: "POST", body: { name: $("#an").value, category: $("#ac").value, price: +$("#ap").value, stock: +$("#as").value, description: $("#ad").value } }); e.target.reset(); products(); })(); };
if (T) go(load)();
