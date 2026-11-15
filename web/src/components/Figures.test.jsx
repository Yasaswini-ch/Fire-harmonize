import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Figures from "./Figures.jsx";

const html = (props) => renderToStaticMarkup(createElement(Figures, props));

describe("Figures", () => {
  const out = html({ regionId: "western_na", regionName: "Western North America" });
  it("shows the raw, validation and drift pictures of the chosen region", () => {
    for (const kind of ["raw", "validation", "drift"]) expect(out).toContain(`figures/western_na_${kind}.png`);
    expect(out).not.toContain("zambia_");
  });
  it("gives every picture a text description and fixed size, and opens the full picture on click", () => {
    expect((out.match(/<img /g) ?? []).length).toBe(3);
    expect((out.match(/alt="[^"]{40,}"/g) ?? []).length).toBe(3);
    expect(out).toContain("for Western North America");
    expect((out.match(/target="_blank"/g) ?? []).length).toBe(3);
    expect((out.match(/ width="\d+" height="\d+"/g) ?? []).length).toBe(3);
  });
  it("says the pictures are not redrawn and that the 2022 check is not a tuning target", () => {
    expect(out).toContain("not redrawn or edited");
    expect(out).toContain("not a tuning target");
  });
  it("renders nothing without a region", () => {
    expect(html({ regionId: null, regionName: "" })).toBe("");
  });
});
