import { describe, expect, it } from 'vitest';
import { hashNameForGoogle, hashNameForMeta, isPlaceholderEmail, sha256Hex } from '../src';

describe('titles before a first name', () => {
  it('Indian titles are dropped for Meta and Google alike', () => {
    for (const raw of ['Smt Priya', 'Smt. Priya', 'Shri Priya', 'Shrimati Priya', 'Srimati Priya', 'Kumari Priya', 'Mrs. Priya']) {
      expect(hashNameForMeta(raw)).toBe(sha256Hex('priya'));
      expect(hashNameForGoogle(raw)).toBe(sha256Hex('priya'));
    }
  });

  it('"Sri" and "Shree" stay: they are often part of the name itself', () => {
    expect(hashNameForMeta('Sri Devi')).toBe(sha256Hex('sri devi'));
    expect(hashNameForMeta('Shree Lakshmi')).toBe(sha256Hex('shree lakshmi'));
  });

  it('a title is never the whole name, and last names are left alone', () => {
    expect(hashNameForMeta('Kumari')).toBe(sha256Hex('kumari'));
    expect(hashNameForMeta('Smt Shah', 'family')).toBe(sha256Hex('smt shah'));
  });
});

describe('made-up emails', () => {
  const rule = { domains: ['brand.com'], ownPhone: true };

  it('drops all-digit emails at the brand\'s own domains', () => {
    expect(isPlaceholderEmail('9876543210@brand.com', null, rule)).toBe(true);
    expect(isPlaceholderEmail(' 9876543210@Brand.com ', null, rule)).toBe(true);
    expect(isPlaceholderEmail('+919876543210@brand.com', null, rule)).toBe(true);
    expect(isPlaceholderEmail('priya@brand.com', null, rule)).toBe(false);
  });

  it("drops <the customer's own phone>@any domain, but keeps someone else's number-style email", () => {
    expect(isPlaceholderEmail('9876543210@gmail.com', '+91 98765 43210', rule)).toBe(true);
    expect(isPlaceholderEmail('919876543210@gmail.com', '9876543210', rule)).toBe(true);
    expect(isPlaceholderEmail('9123456789@gmail.com', '9876543210', rule)).toBe(false);
    expect(isPlaceholderEmail('9876543210@gmail.com', null, rule)).toBe(false);
    expect(isPlaceholderEmail('9876543210@gmail.com', '9876543210', { domains: [], ownPhone: false })).toBe(false);
  });

  it('keeps every email when the brand has no rule', () => {
    expect(isPlaceholderEmail('9876543210@brand.com', '9876543210', undefined)).toBe(false);
  });
});
