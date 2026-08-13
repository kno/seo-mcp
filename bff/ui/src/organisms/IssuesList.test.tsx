import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SeoIssue } from "../../../../src/seo/analyze";
import { IssuesList } from "./IssuesList";

/**
 * One explicit test per real code `detectSeoIssues` (`src/seo/analyze.ts`)
 * can emit — 13 total, verified directly from source, not from memory or a
 * cached list. A generic loop over an array could silently skip an entry if
 * the array itself were wrong; 13 separate assertions cannot.
 */
describe("IssuesList — real analyzer codes", () => {
  it("renders missing_title (warning)", () => {
    const issues: SeoIssue[] = [
      {
        code: "missing_title",
        severity: "warning",
        message: "Page has no title",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(screen.getByText("Page has no title")).toBeInTheDocument();
    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
  });

  it("renders title_length (info)", () => {
    const issues: SeoIssue[] = [
      {
        code: "title_length",
        severity: "info",
        message: "Title should usually be 15–60 characters",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("Title should usually be 15–60 characters"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
  });

  it("renders missing_description (warning)", () => {
    const issues: SeoIssue[] = [
      {
        code: "missing_description",
        severity: "warning",
        message: "Page has no meta description",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("Page has no meta description"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
  });

  it("renders description_length (info)", () => {
    const issues: SeoIssue[] = [
      {
        code: "description_length",
        severity: "info",
        message: "Meta description is longer than 160 characters",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("Meta description is longer than 160 characters"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
  });

  it("renders missing_h1 (warning)", () => {
    const issues: SeoIssue[] = [
      { code: "missing_h1", severity: "warning", message: "Page has no H1" },
    ];
    render(<IssuesList issues={issues} />);
    expect(screen.getByText("Page has no H1")).toBeInTheDocument();
    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
  });

  it("renders multiple_h1 (info)", () => {
    const issues: SeoIssue[] = [
      {
        code: "multiple_h1",
        severity: "info",
        message: "Page has multiple H1 headings",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("Page has multiple H1 headings"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
  });

  it("renders missing_canonical (info)", () => {
    const issues: SeoIssue[] = [
      {
        code: "missing_canonical",
        severity: "info",
        message: "Page has no canonical link",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(screen.getByText("Page has no canonical link")).toBeInTheDocument();
    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
  });

  it("renders missing_lang (info)", () => {
    const issues: SeoIssue[] = [
      {
        code: "missing_lang",
        severity: "info",
        message: "HTML element has no lang attribute",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("HTML element has no lang attribute"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
  });

  it("renders images_missing_alt (warning)", () => {
    const issues: SeoIssue[] = [
      {
        code: "images_missing_alt",
        severity: "warning",
        message: "3 image(s) are missing alt text",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("3 image(s) are missing alt text"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
  });

  it("renders noindex (warning)", () => {
    const issues: SeoIssue[] = [
      {
        code: "noindex",
        severity: "warning",
        message: "Page is marked noindex",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(screen.getByText("Page is marked noindex")).toBeInTheDocument();
    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
  });

  it("renders invalid_jsonld (warning)", () => {
    const issues: SeoIssue[] = [
      {
        code: "invalid_jsonld",
        severity: "warning",
        message: "1 JSON-LD block(s) failed to parse",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("1 JSON-LD block(s) failed to parse"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
  });

  it("renders missing_open_graph (info)", () => {
    const issues: SeoIssue[] = [
      {
        code: "missing_open_graph",
        severity: "info",
        message: "Page has no Open Graph metadata",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("Page has no Open Graph metadata"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
  });

  it("renders thin_content (info)", () => {
    const issues: SeoIssue[] = [
      {
        code: "thin_content",
        severity: "info",
        message: "Page has thin content (fewer than 250 words)",
      },
    ];
    render(<IssuesList issues={issues} />);
    expect(
      screen.getByText("Page has thin content (fewer than 250 words)"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
  });
});

describe("IssuesList — severity distinction", () => {
  it("uses visually distinct severity indicators matching warning and info", () => {
    const issues: SeoIssue[] = [
      { code: "missing_title", severity: "warning", message: "m1" },
      { code: "thin_content", severity: "info", message: "m2" },
    ];
    render(<IssuesList issues={issues} />);

    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
    expect(screen.getByTestId("badge-info")).toBeInTheDocument();
  });
});

describe("IssuesList — empty state", () => {
  it("shows an explicit 'no issues detected' state for a zero-length array from a successful analysis", () => {
    render(<IssuesList issues={[]} />);
    expect(screen.getByText(/no issues detected/i)).toBeInTheDocument();
  });
});

describe("IssuesList — unrecognized future code", () => {
  it("renders an unrecognized code visibly, with its raw code, message, and severity — never empty or dropped", () => {
    const issues: SeoIssue[] = [
      {
        code: "future_unknown_code",
        severity: "warning",
        message: "Something new the analyzer started emitting",
      },
    ];
    render(<IssuesList issues={issues} />);

    expect(screen.getByText("future_unknown_code")).toBeInTheDocument();
    expect(
      screen.getByText("Something new the analyzer started emitting"),
    ).toBeInTheDocument();
    // Its own reported severity must still drive the badge — the view must
    // not invent or reclassify an unmapped code as some other severity.
    expect(screen.getByTestId("badge-warning")).toBeInTheDocument();
    expect(screen.getByTestId("issue-unmapped")).toBeInTheDocument();
  });
});
