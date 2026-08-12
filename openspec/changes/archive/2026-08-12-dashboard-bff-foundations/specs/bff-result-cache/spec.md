# Delta for BFF Result Cache

## ADDED Requirements

### Requirement: KV-Backed Result Cache With Configurable TTL

The BFF MUST cache successful tool results in a KV namespace keyed by tool name and normalized request inputs. Each tool's cache TTL MUST be configurable (not hardcoded to an unstated value) and bounded (a maximum TTL MUST be enforceable). The system MUST NOT depend on any in-memory cache surviving across requests or isolates, since Workers provide no persistent in-memory state guarantee across invocations.

#### Scenario: Repeated identical request within TTL is served from cache

- GIVEN a dashboard request for `crawl_page` on a given URL was already served and cached
- WHEN an identical request arrives again before the TTL expires
- THEN the BFF MUST return the cached result without invoking the MCP tool again

#### Scenario: Expired entry triggers a fresh call

- GIVEN a cached entry whose TTL has elapsed
- WHEN a matching request arrives
- THEN the BFF MUST treat this as a cache miss and invoke the MCP tool

### Requirement: Best-Effort Single-Flight Dedupe

The BFF SHOULD deduplicate concurrent identical in-flight requests within a single isolate so that only one upstream MCP call is made per unique request while others await its result. This deduplication is isolate-local and best-effort: it MUST NOT be presented or relied upon as a global coalescing guarantee across isolates, since KV read-after-write is eventually consistent and no cross-isolate coordination primitive is introduced by this change.

#### Scenario: Concurrent identical requests in one isolate coalesce

- GIVEN two concurrent requests for the same tool and identical inputs arrive in the same isolate
- WHEN neither has a cached result yet
- THEN the BFF SHOULD make only one upstream MCP call and satisfy both requests from its result

#### Scenario: Concurrent identical requests across isolates are not guaranteed to coalesce

- GIVEN two concurrent requests for the same tool and identical inputs are routed to different isolates
- WHEN neither isolate has a cached result yet
- THEN each isolate MAY independently invoke the MCP tool
- AND this is an accepted best-effort limitation, not a contract violation

### Requirement: Cache Failure Does Not Block Requests

If the KV binding is absent, unreachable, or returns an error, the BFF MUST treat this as a cache miss and continue serving the request via a direct MCP call rather than failing the request closed.

#### Scenario: KV binding is not configured

- GIVEN the KV namespace binding is missing from the BFF's environment
- WHEN a dashboard request arrives
- THEN the BFF MUST still invoke the MCP tool and return a result
- AND MUST NOT return an error solely because caching was unavailable

#### Scenario: KV read fails transiently

- GIVEN a KV read for a cache lookup fails with a transient error
- WHEN the BFF handles the request
- THEN the BFF MUST fall back to invoking the MCP tool directly
