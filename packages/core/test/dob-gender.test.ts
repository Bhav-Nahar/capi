import { describe, expect, it } from 'vitest';
import { hashDobForMeta, hashGenderForMeta, sha256Hex } from '../src';

const now = new Date('2026-11-13T00:00:00Z');

describe('date of birth for Meta', () => {
  it('becomes YYYYMMDD, hashed', () => {
    expect(hashDobForMeta('1997-02-16', now)).toBe(sha256Hex('19970216'));
    expect(hashDobForMeta(' 1997-02-16 ', now)).toBe(sha256Hex('19970216'));
  });

  it('only takes an ISO date: 02/03/1997 is a different day in India and the US', () => {
    expect(hashDobForMeta('16/02/1997', now)).toBeNull();
    expect(hashDobForMeta('02/16/1997', now)).toBeNull();
    expect(hashDobForMeta('19970216', now)).toBeNull();
  });

  it('refuses days that do not exist, years before 1900 and future dates', () => {
    expect(hashDobForMeta('1997-02-30', now)).toBeNull();
    expect(hashDobForMeta('1899-12-31', now)).toBeNull();
    expect(hashDobForMeta('2027-01-01', now)).toBeNull();
    expect(hashDobForMeta('', now)).toBeNull();
    expect(hashDobForMeta(undefined, now)).toBeNull();
  });
});

describe('gender for Meta', () => {
  it('becomes f or m, hashed', () => {
    expect(hashGenderForMeta('F')).toBe(sha256Hex('f'));
    expect(hashGenderForMeta('female')).toBe(sha256Hex('f'));
    expect(hashGenderForMeta(' Male ')).toBe(sha256Hex('m'));
  });

  it('leaves anything else out rather than guessing', () => {
    expect(hashGenderForMeta('other')).toBeNull();
    expect(hashGenderForMeta('')).toBeNull();
    expect(hashGenderForMeta(null)).toBeNull();
  });
});
