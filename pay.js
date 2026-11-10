// Shared checkout helper. Talks only to OUR server; the server verifies every payment with the provider.
import { S } from './store.js';

const RZP = 'https://checkout.razorpay.com/v1/checkout.js';
export async function api(path, body) {
  await S.sb.auth.restore().catch(() => {});
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.sb.getToken() }, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { message: data.error || res.statusText, code: String(res.status) };
  return data;
}
const loadCheckout = () => window.Razorpay ? Promise.resolve() : new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = RZP; s.onload = ok; s.onerror = () => no({ message: 'Failed to fetch' }); document.head.append(s);
});
// Opens the provider's checkout for an order created by our server, then asks our server to verify it.
// Resolves with the server's answer; rejects with {cancelled:true} when the buyer closes the window.
export async function payOrder(order, description) {
  await loadCheckout();
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay({
      key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
      name: 'Alfrzo Ilm', description, prefill: { email: S.user.email }, theme: { color: '#0a5c47' },
      handler: resp => api('/api/payments/verify', { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }).then(resolve, reject),
      modal: { ondismiss: () => reject({ cancelled: true }) },
    });
    rz.on('payment.failed', () => reject({ message: 'payment failed', failed: true }));
    rz.open();
  });
}
