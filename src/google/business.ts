import { LIMITS, type Env } from "../config";
import { getGoogleAccessToken } from "./auth";
import { globalCredentials } from "./credential-types";

// ---------------------------------------------------------------------------
// Google Business Profile is served by four fragmented host services.
// ---------------------------------------------------------------------------
const ACCOUNT_MGMT = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const PERFORMANCE = "https://businessprofileperformance.googleapis.com/v1";
const MYBUSINESS_V4 = "https://mybusiness.googleapis.com/v4";

const REFUSE_WRITE =
  "Refusing to write: pass confirm=true to execute this Business Profile change";

// PROVISIONAL: unverified against live API, reconcile after Business Profile
// access approval. The project quota is currently 0 pending Google approval, so
// every request/response shape below comes from the API docs, not live traffic.
// The pieces we fully control — HTTP method, URL, auth header, and body/query
// construction — are exercised by the tests; response normalization assumes the
// documented shapes.

interface BusinessRequestOptions {
  body?: unknown;
  fetcher?: typeof fetch;
  now?: () => number;
}

// Shared low-level request helper: attaches the OAuth bearer token, enforces a
// timeout, and surfaces Google error messages. Business Profile does NOT use a
// developer-token header (unlike Google Ads).
async function businessRequest<T = unknown>(
  method: string,
  url: string,
  env: Env,
  { body, fetcher = fetch, now }: BusinessRequestOptions = {},
): Promise<T> {
  // Business Profile is explicitly out of scope for per-site credentials —
  // always the global env tier.
  const token = await getGoogleAccessToken(
    globalCredentials(env),
    fetcher,
    now,
  );

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LIMITS.businessTimeoutMs,
  );
  try {
    const response = await fetcher(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = (await response.json()) as T & {
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(
        data.error?.message ??
          `Business Profile request failed (HTTP ${response.status})`,
      );
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveLocation(param: string | undefined, env: Env): string {
  const location = param ?? env.GOOGLE_BUSINESS_LOCATION;
  if (!location) {
    throw new Error("Business location not configured");
  }
  return location;
}

// PROVISIONAL: storefrontAddress shape assumed from docs.
interface PostalAddress {
  addressLines?: string[];
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
}

function formatAddress(address: PostalAddress | undefined): string | undefined {
  if (!address) return undefined;
  const parts = [
    ...(address.addressLines ?? []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

// ---------------------------------------------------------------------------
// READ: listBusinessLocations
// ---------------------------------------------------------------------------

interface RawAccount {
  name?: string;
  accountName?: string;
}

interface RawLocation {
  name?: string;
  title?: string;
  websiteUri?: string;
  phoneNumbers?: { primaryPhone?: string };
  storefrontAddress?: PostalAddress;
}

export interface BusinessAccount {
  name: string;
  accountName?: string;
}

export interface BusinessLocation {
  name: string;
  title: string;
  websiteUri?: string;
  phone?: string;
  address?: string;
}

export async function listBusinessLocations(
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<{ accounts: BusinessAccount[]; locations: BusinessLocation[] }> {
  const accountsData = await businessRequest<{ accounts?: RawAccount[] }>(
    "GET",
    `${ACCOUNT_MGMT}/accounts`,
    env,
    { fetcher, now },
  );

  const accounts: BusinessAccount[] = (accountsData.accounts ?? [])
    .filter((a): a is RawAccount & { name: string } => !!a.name)
    .map((a) => ({ name: a.name, accountName: a.accountName }));

  const account = env.GOOGLE_BUSINESS_ACCOUNT ?? accounts[0]?.name;
  let locations: BusinessLocation[] = [];

  if (account) {
    const readMask = "name,title,storefrontAddress,websiteUri,phoneNumbers";
    const locationsData = await businessRequest<{ locations?: RawLocation[] }>(
      "GET",
      `${BUSINESS_INFO}/${account}/locations?readMask=${readMask}&pageSize=100`,
      env,
      { fetcher, now },
    );
    locations = (locationsData.locations ?? []).map((loc) => ({
      name: loc.name ?? "",
      title: loc.title ?? "",
      websiteUri: loc.websiteUri,
      phone: loc.phoneNumbers?.primaryPhone,
      address: formatAddress(loc.storefrontAddress),
    }));
  }

  return { accounts, locations };
}

// ---------------------------------------------------------------------------
// READ: getBusinessReviews
// ---------------------------------------------------------------------------

// PROVISIONAL: review shape assumed from the legacy v4 API docs.
interface RawReview {
  name?: string;
  reviewer?: { displayName?: string };
  starRating?: string;
  comment?: string;
  createTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

export interface BusinessReview {
  name: string;
  reviewer?: string;
  starRating?: string;
  comment?: string;
  createTime?: string;
  reply: { comment: string; updateTime: string } | null;
}

export async function getBusinessReviews(
  params: { location?: string; pageSize?: number },
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<{ location: string; reviews: BusinessReview[] }> {
  const location = resolveLocation(params.location, env);
  const pageSize = Math.min(params.pageSize ?? 20, LIMITS.maxBusinessReviews);

  // The v4 `location` is the full `accounts/{a}/locations/{l}` path.
  const data = await businessRequest<{ reviews?: RawReview[] }>(
    "GET",
    `${MYBUSINESS_V4}/${location}/reviews?pageSize=${pageSize}`,
    env,
    { fetcher, now },
  );

  const reviews: BusinessReview[] = (data.reviews ?? []).map((r) => ({
    name: r.name ?? "",
    reviewer: r.reviewer?.displayName,
    starRating: r.starRating,
    comment: r.comment,
    createTime: r.createTime,
    reply:
      r.reviewReply && r.reviewReply.comment !== undefined
        ? {
            comment: r.reviewReply.comment,
            updateTime: r.reviewReply.updateTime ?? "",
          }
        : null,
  }));

  return { location, reviews };
}

// ---------------------------------------------------------------------------
// READ: getBusinessPerformance
// ---------------------------------------------------------------------------

// PROVISIONAL: metric names and the fetchMultiDailyMetricsTimeSeries endpoint
// and response shape are assumed from docs, not verified against live traffic.
const DEFAULT_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
];

interface RawDatedValue {
  date?: { year?: number; month?: number; day?: number };
  value?: unknown;
}

interface RawDailyMetricTimeSeries {
  dailyMetric?: string;
  timeSeries?: { datedValues?: RawDatedValue[] };
}

interface RawMultiDailyMetricTimeSeries {
  dailyMetricTimeSeries?: RawDailyMetricTimeSeries[];
}

export interface PerformanceSeries {
  metric: string;
  values: Array<{ date: string; value: number }>;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoFromParts(date: RawDatedValue["date"]): string {
  if (!date || date.year == null || date.month == null || date.day == null) {
    return "";
  }
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

export async function getBusinessPerformance(
  params: {
    location?: string;
    startDate: string;
    endDate: string;
    metrics?: string[];
  },
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<{
  location: string;
  startDate: string;
  endDate: string;
  series: PerformanceSeries[];
}> {
  const location = resolveLocation(params.location, env);
  const metrics = params.metrics ?? DEFAULT_METRICS;

  const [sy, sm, sd] = params.startDate.split("-");
  const [ey, em, ed] = params.endDate.split("-");

  const query = new URLSearchParams();
  for (const metric of metrics) {
    query.append("dailyMetrics", metric);
  }
  query.append("dailyRange.startDate.year", String(Number(sy)));
  query.append("dailyRange.startDate.month", String(Number(sm)));
  query.append("dailyRange.startDate.day", String(Number(sd)));
  query.append("dailyRange.endDate.year", String(Number(ey)));
  query.append("dailyRange.endDate.month", String(Number(em)));
  query.append("dailyRange.endDate.day", String(Number(ed)));

  const data = await businessRequest<{
    multiDailyMetricTimeSeries?: RawMultiDailyMetricTimeSeries[];
  }>(
    "GET",
    `${PERFORMANCE}/${location}:fetchMultiDailyMetricsTimeSeries?${query.toString()}`,
    env,
    { fetcher, now },
  );

  const series: PerformanceSeries[] = [];
  for (const multi of data.multiDailyMetricTimeSeries ?? []) {
    for (const dm of multi.dailyMetricTimeSeries ?? []) {
      series.push({
        metric: dm.dailyMetric ?? "",
        values: (dm.timeSeries?.datedValues ?? []).map((dv) => ({
          date: isoFromParts(dv.date),
          value: Number(dv.value) || 0,
        })),
      });
    }
  }

  return {
    location,
    startDate: params.startDate,
    endDate: params.endDate,
    series,
  };
}

// ---------------------------------------------------------------------------
// WRITE functions — each guarded by an explicit confirm flag because they
// mutate live, public Business Profile data.
// ---------------------------------------------------------------------------

function assertConfirmed(confirm: boolean): void {
  if (confirm !== true) {
    throw new Error(REFUSE_WRITE);
  }
}

export async function replyToReview(
  params: { review: string; comment: string; confirm: boolean },
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<unknown> {
  assertConfirmed(params.confirm);
  // review = full `accounts/{a}/locations/{l}/reviews/{r}` path.
  return businessRequest(
    "PUT",
    `${MYBUSINESS_V4}/${params.review}/reply`,
    env,
    { body: { comment: params.comment }, fetcher, now },
  );
}

export async function updateBusinessInfo(
  params: {
    location?: string;
    updateMask: string;
    fields: Record<string, unknown>;
    confirm: boolean;
  },
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<unknown> {
  assertConfirmed(params.confirm);
  const location = resolveLocation(params.location, env);
  return businessRequest(
    "PATCH",
    `${BUSINESS_INFO}/${location}?updateMask=${params.updateMask}`,
    env,
    { body: params.fields, fetcher, now },
  );
}

export async function createLocalPost(
  params: {
    location?: string;
    post: Record<string, unknown>;
    confirm: boolean;
  },
  env: Env,
  fetcher: typeof fetch = fetch,
  now?: () => number,
): Promise<unknown> {
  assertConfirmed(params.confirm);
  const location = resolveLocation(params.location, env);
  return businessRequest(
    "POST",
    `${MYBUSINESS_V4}/${location}/localPosts`,
    env,
    { body: params.post, fetcher, now },
  );
}
