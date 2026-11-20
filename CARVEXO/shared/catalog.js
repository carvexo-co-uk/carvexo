import content from './report-content.json' with { type: 'json' };

export const currency = 'gbp';
export const packages = [
  { key: 'basic', ...content.basic, amount: 2000 },
  { key: 'full', ...content.full, amount: 3000 },
];
export const reportContent = content;

export function getPackage(key) {
  return packages.find((option) => option.key === key);
}

export function formatPrice(amount) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

export function registrationFrom(input) {
  if (typeof input !== 'string' || input.length > 24) return null;
  const display = input.trim().toUpperCase().replace(/\s+/g, ' ');
  const key = display.replace(/ /g, '');
  const valid = /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(key)
    || /^[A-Z]\d{1,3}[A-Z]{2,3}$/.test(key)
    || /^[A-Z]{3}\d{1,3}[A-Z]$/.test(key)
    || /^(?:[A-Z]{1,3}\d{1,4}|\d{1,4}[A-Z]{1,3})$/.test(key)
    || /^\d{3}[DX]\d{3}$/.test(key);
  if (!valid) return null;
  return { key, display };
}
