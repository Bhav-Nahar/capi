import type { Channel, TenantConfig } from '@datahash/core';

/** The one shape every source (Zoho, generic webhook, Shopify later) is turned into. */
export interface IncomingSale {
  source: string;
  /** Stable ID from the source (Zoho deal ID). Used for idempotency and as Meta event_id / Google order_id. */
  eventId: string;
  eventName: string;
  channel: Channel;
  occurredAt: Date;
  value?: number;
  currency?: string;
  storeName?: string;
  phone?: string;
  email?: string;
  /** Optional customer details. Each one the source can give raises the match rate; all are hashed before storing. */
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** The address country: a code (IN) or English name (India). Not guessed from the phone number. */
  country?: string;
  /** The brand's own ID for this customer (the CRM contact ID). */
  customerId?: string;
  /** Date of birth as an ISO date (1997-02-16). Hashed for Meta; anything else is ignored. */
  dateOfBirth?: string;
  /** "f"/"female" or "m"/"male". Hashed for Meta; anything else is ignored. */
  gender?: string;
  /** Consent captured by the source (e.g. a CRM field). undefined = the source did not say. */
  consent?: boolean;
}

export type AdapterRejection =
  | 'invalid_payload'
  | 'not_won'
  | 'missing_deal_id'
  | 'invalid_amount'
  | 'invalid_date'
  | 'invalid_consent'
  | 'unknown_channel'
  /** Only Purchase is supported for now. */
  | 'unsupported_event'
  /** A Purchase needs a value: Meta refuses a Purchase without value and currency. */
  | 'missing_value';

export type AdapterResult =
  | { ok: true; sale: IncomingSale }
  | { ok: false; reason: AdapterRejection; detail?: string };

/** The parts of a brand's settings the ingestion pipeline needs. */
export type IngestTenant = Pick<
  TenantConfig,
  'tenantId' | 'consentPolicy' | 'allowedChannels' | 'destinations' | 'defaultCountry' | 'sources' | 'placeholderEmails'
> & {
  /** How long customer data is kept; the server uses it when it opens the store for this brand. */
  retentionDays?: number;
};
