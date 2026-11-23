/**
 * The shop's pages (ADR 0065 d4): the cart, checkout and an order, drawn in
 * the site's own frame and language, without script: each is a form the
 * browser sends by itself. And an order as the text its messages carry.
 */
import { moneyText, ORDER_STATES, type OrderState, type ShippingMethod, type ShopSettings } from '../core/index.ts';
import { type Words, wordsFor } from '../blocks/words.ts';
import { escape } from './framed.ts';

/** One line of a cart, as it can be bought now. */
export interface CartLine {
  /** `type/slug` */
  product: string;
  variant: string;
  quantity: number;
  name: string;
  /** Where its page is. */
  href: string;
  sku: string;
  /** What one costs now, with VAT; null: it can no longer be bought. */
  price: number | null;
  rate: number;
  /** What is left when its stock is counted; null when it is not. */
  left: number | null;
}

/** What an order costs, worked out the same way for the cart, checkout and the order kept. */
export interface Totals {
  subtotal: number;
  shipping: number;
  total: number;
  /** The VAT in the total, by rate, in the order of the site's rates; empty when VAT is not charged. */
  vat: [number, number][];
}

/** An order as it is kept (ADR 0065 d7): the lines as they were bought, the buyer, and how it is paid and delivered. */
export interface OrderData {
  buyer: { name: string; email: string; phone: string; street: string; town: string; county: string; postcode: string; company: { name: string; taxCode: string; registration: string } | null };
  lines: { product: string; variant: string; name: string; sku: string; price: number; quantity: number; rate: number }[];
  shipping: { id: string; name: string; price: number; pickup: string };
  payment: 'transfer' | 'cod';
  /** The account to pay into, as it was when the order was placed. */
  transfer: { holder: string; iban: string; bank: string } | null;
  totals: Totals;
  /** VAT was charged when it was placed. */
  vat: boolean;
  currency: string;
  note: string;
  tracking: string;
  history: { state: OrderState; at: string }[];
}

export interface Order {
  id: string;
  number: number;
  secret: string;
  state: OrderState;
  email: string;
  visitorId: string;
  language: string;
  total: number;
  createdAt: string;
  updatedAt: string;
  data: OrderData;
}

/** A state's name in a language. */
export const stateName = (said: Words, state: OrderState): string => said.orderStates.split('|')[ORDER_STATES.indexOf(state)] ?? state;

/** The day an order was placed, in the language it was placed in. */
export function dayOf(at: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language || 'en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(at));
  } catch {
    return at.slice(0, 10);
  }
}

/** The sums under the lines: subtotal, delivery, total, and the VAT in it. */
export function totalsPart(said: Words, totals: Totals, money: (n: number) => string, shippingName: string | null, vat: boolean): string {
  const row = (label: string, value: string, attrs = ''): string => `<tr${attrs}><th scope="row">${escape(label)}</th><td>${escape(value)}</td></tr>`;
  return (
    `<table class="cart-totals"><tbody>` +
    row(said.cartSubtotal, money(totals.subtotal)) +
    (shippingName === null ? '' : row(`${said.cartShipping}${shippingName ? ` (${shippingName})` : ''}`, totals.shipping ? money(totals.shipping) : said.cartShippingFree)) +
    row(said.cartTotal, money(totals.total), ' class="cart-total" data-cart-total') +
    totals.vat.map(([rate, amount]) => row(said.cartVatOf.replace('{rate}', String(rate)), money(amount))).join('') +
    `</tbody></table>` +
    (vat ? '' : `<p class="cart-no-vat"><small>${escape(said.cartNoVat)}</small></p>`)
  );
}

/** The lines of an order, or of a cart that is only read. */
export function linesPart(said: Words, lines: { name: string; variant: string; price: number; quantity: number; href?: string }[], money: (n: number) => string): string {
  return (
    `<table class="cart-lines"><thead><tr><th scope="col">${escape(said.cartProduct)}</th><th scope="col">${escape(said.cartPrice)}</th><th scope="col">${escape(said.shopQuantity)}</th><th scope="col">${escape(said.cartLineTotal)}</th></tr></thead><tbody>` +
    lines
      .map(
        (l) =>
          `<tr><td>${l.href ? `<a href="${escape(l.href)}">${escape(l.name)}</a>` : escape(l.name)}${l.variant ? `<br><small>${escape(l.variant)}</small>` : ''}</td>` +
          `<td>${escape(money(l.price))}</td><td>${l.quantity}</td><td>${escape(money(l.price * l.quantity))}</td></tr>`,
      )
      .join('') +
    `</tbody></table>`
  );
}

/** How to pay for an order: the account and the payment's details, or that it is paid on delivery. */
export function payText(said: Words, order: Pick<Order, 'number' | 'data'>, money: (n: number) => string): string {
  const { data } = order;
  if (data.payment === 'cod') return said.orderPayCod.replace('{total}', money(data.totals.total));
  const transfer = data.transfer ?? { holder: '', iban: '', bank: '' };
  return said.orderPayTransfer
    .replace('{total}', money(data.totals.total))
    .replace('{iban}', transfer.iban)
    .replace('{bank}', transfer.bank)
    .replace('{holder}', transfer.holder)
    .replace('{reference}', said.order.replace('{number}', String(order.number)));
}

const addressOf = (buyer: OrderData['buyer']): string => [buyer.street, buyer.postcode, buyer.town, buyer.county].filter(Boolean).join(', ');

/** An order, as its buyer reads it on its page. */
export function orderPart(said: Words, order: Order, money: (n: number) => string): string {
  const { data } = order;
  const company = data.buyer.company;
  const waiting = order.state === 'waiting';
  return (
    `<p class="lead" data-order-state="${order.state}">${escape(said.orderState)}: <strong>${escape(stateName(said, order.state))}</strong></p>` +
    `<p>${escape(said.orderDate)} ${escape(dayOf(order.createdAt, order.language))}</p>` +
    (data.tracking && (order.state === 'sent' || order.state === 'completed') ? `<p data-order-tracking>${escape(said.orderTracking.replace('{tracking}', data.tracking))}</p>` : '') +
    (waiting || (data.payment === 'cod' && !['completed', 'cancelled', 'refunded'].includes(order.state))
      ? `<h2>${escape(said.orderPay)}</h2><p data-order-pay>${escape(payText(said, order, money))}</p>`
      : '') +
    linesPart(said, data.lines, money) +
    totalsPart(said, data.totals, money, data.shipping.name, data.vat) +
    `<h2>${escape(said.orderBuyer)}</h2><p>${escape(data.buyer.name)}<br>${escape(data.shipping.pickup ? said.checkoutPickup.replace('{address}', data.shipping.pickup) : addressOf(data.buyer))}<br>${escape(data.buyer.email)} · ${escape(data.buyer.phone)}</p>` +
    (company ? `<h2>${escape(said.orderCompany)}</h2><p>${escape(company.name)}<br>${escape(company.taxCode)}${company.registration ? ` · ${escape(company.registration)}` : ''}</p>` : '') +
    (data.note ? `<h2>${escape(said.orderNote)}</h2><p>${escape(data.note)}</p>` : '')
  );
}

/** An order as the text of its messages: `{order}` in their words. */
export function orderText(order: Order): string {
  const said = wordsFor(order.language);
  const { data } = order;
  const money = (n: number): string => moneyText(n, data.currency, order.language);
  const out = [said.order.replace('{number}', String(order.number)), ''];
  for (const l of data.lines) out.push(`${l.quantity} × ${l.name}${l.variant ? ` (${l.variant})` : ''}: ${money(l.price * l.quantity)}`);
  out.push('', `${said.cartSubtotal}: ${money(data.totals.subtotal)}`);
  out.push(`${said.cartShipping} (${data.shipping.name}): ${data.totals.shipping ? money(data.totals.shipping) : said.cartShippingFree}`);
  out.push(`${said.cartTotal}: ${money(data.totals.total)}`);
  for (const [rate, amount] of data.totals.vat) out.push(`${said.cartVatOf.replace('{rate}', String(rate))}: ${money(amount)}`);
  out.push('', `${said.orderPay}: ${payText(said, order, money)}`);
  out.push('', `${said.orderBuyer}: ${data.buyer.name}, ${data.shipping.pickup ? said.checkoutPickup.replace('{address}', data.shipping.pickup) : addressOf(data.buyer)}, ${data.buyer.phone}`);
  if (data.buyer.company) out.push(`${said.orderCompany}: ${data.buyer.company.name}, ${data.buyer.company.taxCode}${data.buyer.company.registration ? `, ${data.buyer.company.registration}` : ''}`);
  if (data.note) out.push(`${said.orderNote}: ${data.note}`);
  return out.join('\n');
}

/** What a buyer typed at checkout, kept to fill the form again when something is wrong. */
export type Typed = Record<string, string>;

/** The checkout form (ADR 0065 d4). `bad` names the fields to check again. */
export function checkoutForm(
  said: Words,
  settings: ShopSettings,
  options: { action: string; typed: Typed; bad: Set<string>; methods: ShippingMethod[]; money: (n: number) => string; subtotal: number; total: number; payments: ('transfer' | 'cod')[] },
): string {
  const { typed, bad } = options;
  let n = 0;
  const field = (label: string, name: string, type: string, attrs = ''): string => {
    const id = `checkout-${name}-${++n}`;
    const value = typed[name] ?? '';
    return (
      `<p class="form-field"><label for="${id}">${escape(label)}</label>` +
      `<input id="${id}" name="${name}" type="${type}"${value ? ` value="${escape(value)}"` : ''}${bad.has(name) ? ' aria-invalid="true"' : ''} ${attrs}></p>`
    );
  };
  const radio = (name: string, value: string, label: string, hint = ''): string =>
    `<label class="form-choice"><input type="radio" name="${name}" value="${escape(value)}"${typed[name] === value ? ' checked' : ''} required> <span>${escape(label)}${hint ? `<br><small>${escape(hint)}</small>` : ''}</span></label>`;
  const shipping = options.methods
    .map((m) => {
      const cost = m.free !== null && options.subtotal >= m.free ? 0 : m.price;
      return radio('shipping', m.id, `${m.name}: ${cost ? options.money(cost) : said.cartShippingFree}`, m.pickup ? said.checkoutPickup.replace('{address}', m.pickup) : '');
    })
    .join('');
  const payments = options.payments.map((p) => (p === 'transfer' ? radio('payment', 'transfer', said.checkoutTransfer, said.checkoutTransferHint) : radio('payment', 'cod', said.checkoutCod))).join('');
  return (
    `<form class="form checkout" method="post" action="${escape(options.action)}" accept-charset="utf-8">` +
    `<input type="hidden" name="total" value="${options.total}">` +
    `<h2>${escape(said.checkoutContact)}</h2>` +
    field(said.checkoutName, 'name', 'text', 'maxlength="120" autocomplete="name" required') +
    field(said.checkoutEmail, 'email', 'email', 'maxlength="254" autocomplete="email" required') +
    field(said.checkoutPhone, 'phone', 'tel', 'maxlength="30" autocomplete="tel" required') +
    `<fieldset${bad.has('shipping') ? ' aria-invalid="true"' : ''}><legend>${escape(said.checkoutShipping)}</legend>${shipping}</fieldset>` +
    `<h2>${escape(said.checkoutAddress)}</h2>` +
    field(said.checkoutStreet, 'street', 'text', 'maxlength="200" autocomplete="street-address"') +
    field(said.checkoutTown, 'town', 'text', 'maxlength="100" autocomplete="address-level2"') +
    field(said.checkoutCounty, 'county', 'text', 'maxlength="100" autocomplete="address-level1"') +
    field(said.checkoutPostcode, 'postcode', 'text', 'maxlength="20" autocomplete="postal-code"') +
    `<p class="form-field form-consent"><label><input type="checkbox" name="company" value="yes"${typed.company === 'yes' ? ' checked' : ''}> ${escape(said.checkoutCompany)}</label></p>` +
    field(said.checkoutCompanyName, 'companyName', 'text', 'maxlength="200" autocomplete="organization"') +
    field(said.checkoutTaxCode, 'taxCode', 'text', 'maxlength="30"') +
    field(said.checkoutRegistration, 'registration', 'text', 'maxlength="40"') +
    `<fieldset${bad.has('payment') ? ' aria-invalid="true"' : ''}><legend>${escape(said.checkoutPayment)}</legend>${payments}</fieldset>` +
    `<p class="form-field"><label for="checkout-note">${escape(said.checkoutNote)}</label><textarea id="checkout-note" name="note" rows="3" maxlength="1000">${escape(typed.note ?? '')}</textarea></p>` +
    `<p class="form-field form-consent"><label><input type="checkbox" name="terms" value="yes" required${bad.has('terms') ? ' aria-invalid="true"' : ''}> ${escape(said.checkoutTerms)}</label>` +
    `${settings.terms ? ` <a href="${escape(settings.terms)}">${escape(said.checkoutTermsLink)}</a>` : ''}</p>` +
    `<p><button class="button" type="submit">${escape(said.cartCheckout)}</button></p></form>`
  );
}
