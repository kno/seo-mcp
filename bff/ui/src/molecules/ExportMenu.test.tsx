import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportMenu } from "./ExportMenu";

describe("ExportMenu", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    clickSpy.mockRestore();
  });

  it("triggers a JSON download with the caller-supplied content on click", async () => {
    const user = userEvent.setup();
    render(
      <ExportMenu
        jsonContent='{"result":{}}'
        csvContent="url\n"
        filenameBase="crawl-site"
      />,
    );

    await user.click(screen.getByRole("button", { name: /export json/i }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("triggers a CSV download with the caller-supplied content on click", async () => {
    const user = userEvent.setup();
    render(
      <ExportMenu
        jsonContent="{}"
        csvContent="url\nhttps://example.com"
        filenameBase="crawl-site"
      />,
    );

    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("text/csv");
  });

  it("succeeds unconditionally — export is never blocked by any bound in the content", async () => {
    const user = userEvent.setup();
    render(
      <ExportMenu
        jsonContent='{"provenance":{"bounds":[{"kind":"output_bytes"}]}}'
        csvContent="# bound: output_bytes\nurl\n"
        filenameBase="crawl-site"
      />,
    );

    await user.click(screen.getByRole("button", { name: /export json/i }));
    await user.click(screen.getByRole("button", { name: /export csv/i }));

    expect(clickSpy).toHaveBeenCalledTimes(2);
  });
});
