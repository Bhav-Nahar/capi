import { sha256Hex } from './hash';

const key = (raw: string) => raw.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');

const IN: Record<string, string> = {
  'Andaman and Nicobar Islands': 'AN', 'Andhra Pradesh': 'AP', 'Arunachal Pradesh': 'AR', Assam: 'AS', Bihar: 'BR', Chandigarh: 'CH',
  Chhattisgarh: 'CG', 'Dadra and Nagar Haveli and Daman and Diu': 'DH', 'Dadra and Nagar Haveli': 'DH', 'Daman and Diu': 'DH',
  Delhi: 'DL', 'New Delhi': 'DL', 'NCT of Delhi': 'DL', Goa: 'GA', Gujarat: 'GJ', Haryana: 'HR', 'Himachal Pradesh': 'HP',
  'Jammu and Kashmir': 'JK', Jharkhand: 'JH', Karnataka: 'KA', Kerala: 'KL', Ladakh: 'LA', Lakshadweep: 'LD', 'Madhya Pradesh': 'MP',
  Maharashtra: 'MH', Manipur: 'MN', Meghalaya: 'ML', Mizoram: 'MZ', Nagaland: 'NL', Odisha: 'OD', Orissa: 'OD', Puducherry: 'PY',
  Pondicherry: 'PY', Punjab: 'PB', Rajasthan: 'RJ', Sikkim: 'SK', 'Tamil Nadu': 'TN', Telangana: 'TS', Tripura: 'TR',
  'Uttar Pradesh': 'UP', Uttarakhand: 'UK', Uttaranchal: 'UK', 'West Bengal': 'WB',
};

const US: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

const table = (t: Record<string, string>) => new Map(Object.entries(t).map(([name, code]) => [key(name), code]));
const BY_NAME = { IN: table(IN), US: table(US) };
const CODES = { IN: new Set(Object.values(IN)), US: new Set(Object.values(US)) };

/**
 * The state as the short code ("Maharashtra" -> "MH") when it is a state we know, in India or the US; null when it is
 * not recognised. A two-letter value is only accepted if it is a real code. `country` (ISO code) picks the table;
 * without it both are tried, India first.
 */
export function stateCode(raw: string | null | undefined, country?: string | null): string | null {
  return findState(raw, country)?.code ?? null;
}

/** Which table recognised the state, and its code. */
function findState(raw: string | null | undefined, country?: string | null): { country: 'IN' | 'US'; code: string } | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const order = country === 'US' ? (['US'] as const) : country === 'IN' ? (['IN'] as const) : (['IN', 'US'] as const);
  for (const c of order) {
    const named = BY_NAME[c].get(key(s));
    if (named) return { country: c, code: named };
    const upper = s.toUpperCase();
    if (/^[A-Za-z]{2}$/.test(s) && CODES[c].has(upper)) return { country: c, code: upper };
  }
  return null;
}

/** One full name per Indian state code (the first name listed for it), so "MH" and "Maharashtra" hash the same. */
const IN_NAME_BY_CODE = new Map<string, string>();
for (const [name, code] of Object.entries(IN)) if (!IN_NAME_BY_CODE.has(code)) IN_NAME_BY_CODE.set(code, name);

const plainPlace = (raw: string) => raw.normalize('NFKC').trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Meta's rule (customer information parameters, checked Nov 2026): US states as the two-letter code in lowercase
 * ("ca"); outside the US, the name in lowercase with no punctuation, special characters or spaces ("maharashtra").
 * A recognised Indian state is always hashed by its full name, whether it came as "MH" or "Maharashtra".
 */
export function hashStateForMeta(raw: string | null | undefined, country?: string | null): string | null {
  const found = findState(raw, country);
  if (found?.country === 'US') return sha256Hex(found.code.toLowerCase());
  if (found?.country === 'IN') return sha256Hex(plainPlace(IN_NAME_BY_CODE.get(found.code)!));
  const s = plainPlace(raw ?? '');
  return s ? sha256Hex(s) : null;
}
