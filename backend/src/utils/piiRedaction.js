/**
 * High-confidence PII redaction shared by harness ingest and agent messages
 * (fg-42 NFR5).
 *
 * This is deliberately narrower than a DLP product: only shapes that are
 * overwhelmingly likely to be personal data are replaced, so ordinary source
 * code, ids and timestamps survive.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Require phone-specific formatting: a bare 10-digit id or timestamp is not PII.
const PHONE = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?!\d)/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;

function luhn(digits) {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function redactPii(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return { text: value || '', count: 0 };
  }
  let count = 0;
  let text = value.replace(EMAIL, () => {
    count += 1;
    return '[REDACTED_EMAIL]';
  });
  text = text.replace(PHONE, () => {
    count += 1;
    return '[REDACTED_PHONE]';
  });
  text = text.replace(SSN, () => {
    count += 1;
    return '[REDACTED_SSN]';
  });
  text = text.replace(CARD, (candidate) => {
    const digits = candidate.replace(/[^0-9]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      count += 1;
      return '[REDACTED_CARD]';
    }
    return candidate;
  });
  return { text, count };
}

function containsPii(value) {
  return redactPii(value).count > 0;
}

module.exports = {
  redactPii,
  containsPii,
  luhn,
};
