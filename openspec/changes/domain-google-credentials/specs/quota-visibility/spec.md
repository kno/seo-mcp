# Delta for Quota Visibility

## ADDED Requirements

### Requirement: Authenticated-Source Quota Is Displayed Per Connected Google Account, Never as One Global Figure

Search Console and Google Ads quota is exhausted per Google account, not per deployment: two sites
connected to two different Google accounts have two independent quota budgets, and a site falling back to
the global env tier shares that tier's single budget with every other site also on the global tier. The
dashboard MUST display the authenticated-source quota estimate (already required to exist by
`authenticated-source-contract`'s "Upstream Quota Is Accounted..." requirement) scoped to the specific
account currently resolved for the active site — i.e. keyed by `credentialSource` and, when
`credentialSource: "site"`, by that site's own connected account — and MUST NOT aggregate or blend call
volume across two different resolved accounts into one figure. Switching the active site to one resolved
against a different account MUST update the displayed quota estimate to that different account's own
observed call volume, not carry over the previous site's figure.

#### Scenario: Two sites on different accounts show independent quota estimates

- GIVEN site A resolves to its own connected Google account and site B resolves to a different connected
  Google account, each with distinct recent call volume
- WHEN a user switches the active site from A to B
- THEN the displayed authenticated-source quota estimate MUST change to reflect site B's own account's
  observed call volume, not site A's

#### Scenario: Sites sharing the global fallback show the shared tier's estimate, not a fabricated per-site split

- GIVEN two sites both resolve to `credentialSource: "global"` with no site-level account of their own
- WHEN a user switches the active site between them
- THEN the displayed quota estimate MUST reflect the shared global tier's own observed call volume for
  both, and MUST NOT be presented as if each site had its own independent global-tier budget

#### Scenario: The quota estimate is labeled with which account it describes

- GIVEN the active site resolves to `credentialSource: "site"`
- WHEN the authenticated-source quota estimate is displayed
- THEN it MUST be labeled or otherwise clearly associated with that site's own connected account, so a
  user does not mistake it for a deployment-wide figure

#### Scenario: Switching to an invalid site clears the quota estimate rather than showing a stale figure

- GIVEN the active site becomes unselectable because its `credentialHealth` is `"invalid"`
- WHEN the dashboard reflects that no site is validly active
- THEN it MUST NOT continue displaying the previously active site's authenticated-source quota estimate
  as if it still applied
