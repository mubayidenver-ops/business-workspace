export function currencyDigits(currency = 'USD') {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Use a three-letter currency code.');
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
}
export function calculateDocument(items, currency = 'USD', discount = 0, tax = 0) {
  if (!Array.isArray(items) || !items.length || items.length > 40)
    throw new Error('Add between 1 and 40 line items.');
  const digits = currencyDigits(currency),
    factor = 10 ** digits;
  discount = Number(discount || 0);
  tax = Number(tax || 0);
  if (
    !Number.isFinite(discount) ||
    discount < 0 ||
    discount > 100 ||
    !Number.isFinite(tax) ||
    tax < 0 ||
    tax > 100
  )
    throw new Error('Discount and tax percentages must be between 0 and 100.');
  const discountBasis = Math.round(discount * 10000),
    taxBasis = Math.round(tax * 10000);
  if (
    Math.abs(discount * 10000 - discountBasis) > 0.000001 ||
    Math.abs(tax * 10000 - taxBasis) > 0.000001
  )
    throw new Error('Discount and tax support up to four decimal places.');
  const fraction = (value, numerator, denominator) =>
    Number((BigInt(value) * BigInt(numerator) + BigInt(denominator / 2)) / BigInt(denominator));
  const lines = items.map((item) => {
    const description = String(item.description || '').trim();
    const quantity = Number(item.quantity),
      rate = Number(item.rate);
    if (
      !description ||
      description.length > 300 ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1e6 ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 1e9
    )
      throw new Error(
        'Each line needs a description, a positive quantity and a valid non-negative rate.',
      );
    const minor = Math.round(rate * factor);
    if (Math.abs(rate * factor - minor) > 0.00001)
      throw new Error(`Rates in ${currency} support ${digits} decimal places.`);
    const scaledQuantity = Math.round(quantity * 10000);
    if (Math.abs(quantity * 10000 - scaledQuantity) > 0.000001)
      throw new Error('Quantities support up to four decimal places.');
    const total = fraction(minor, scaledQuantity, 10000);
    if (!Number.isSafeInteger(total)) throw new Error('This line amount is too large.');
    return { description, quantity, rate: minor / factor, total: total / factor, minor: total };
  });
  const subtotal = lines.reduce((n, l) => n + l.minor, 0);
  if (!Number.isSafeInteger(subtotal)) throw new Error('The document subtotal is too large.');
  const discountAmount = fraction(subtotal, discountBasis, 1000000),
    taxAmount = fraction(subtotal - discountAmount, taxBasis, 1000000),
    total = subtotal - discountAmount + taxAmount;
  if (!Number.isSafeInteger(total) || total / factor > 1e12)
    throw new Error('The document total is too large.');
  return {
    lines: lines.map(({ minor, ...line }) => line),
    subtotal: subtotal / factor,
    discount: discountAmount / factor,
    tax: taxAmount / factor,
    total: total / factor,
    currency,
    digits,
  };
}
export function documentFromData(data) {
  if (!data.lineItems) return null;
  return calculateDocument(
    JSON.parse(data.lineItems),
    String(data.currency || 'USD'),
    data.discountPercent,
    data.taxPercent,
  );
}
