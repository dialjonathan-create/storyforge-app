import { describe, it, expect } from "vitest";
import { segmentProse, stripHtmlComments } from "../src/NarrationPanel";

describe("NarrationPanel Utils", () => {
  it("segments prose into paragraphs", () => {
    const prose = "Para 1\n\nPara 2\nPara 3";
    const segments = segmentProse(prose);
    expect(segments).toEqual(["Para 1", "Para 2", "Para 3"]);
  });

  it("strips HTML comments", () => {
    const text = "Hello <!-- pause -->world";
    expect(stripHtmlComments(text)).toBe("Hello world");

    const text2 = "<!-- pause --> Just start";
    expect(stripHtmlComments(text2)).toBe("Just start");
  });
});
