import { describe, expect, it } from "vitest";
import { placePopover, TOUR_STEPS } from "./tour.js";

const view = { w: 1000, h: 700 };
const size = { w: 340, h: 200 };

describe("placePopover", () => {
  it("goes below the element when there is room", () => {
    const p = placePopover({ top: 100, left: 50, width: 300, height: 60 }, size, view);
    expect(p.placement).toBe("below");
    expect(p.top).toBe(172);
    expect(p.left).toBe(50);
  });
  it("goes above when there is no room below", () => {
    const p = placePopover({ top: 500, left: 50, width: 300, height: 150 }, size, view);
    expect(p.placement).toBe("above");
    expect(p.top).toBe(500 - 12 - 200);
  });
  it("sits at the bottom of the screen when the element is taller than either side", () => {
    const p = placePopover({ top: 40, left: 50, width: 900, height: 620 }, size, view);
    expect(p.placement).toBe("bottom");
    expect(p.top).toBe(700 - 200 - 8);
  });
  it("never lets a tall card run off the bottom of the screen", () => {
    for (const h of [210, 240, 290, 400]) {
      const p = placePopover({ top: 40, left: 50, width: 900, height: 620 }, { w: 340, h }, view);
      expect(p.top + h).toBeLessThanOrEqual(view.h - 8);
      expect(p.top).toBeGreaterThanOrEqual(8);
    }
  });
  it("keeps the card inside the viewport horizontally", () => {
    expect(placePopover({ top: 100, left: 900, width: 90, height: 40 }, size, view).left).toBe(1000 - 340 - 8);
    expect(placePopover({ top: 100, left: -30, width: 90, height: 40 }, size, view).left).toBe(8);
  });
});

describe("TOUR_STEPS", () => {
  it("every step has a selector, a title and a body", () => {
    for (const s of TOUR_STEPS) {
      expect(s.selector).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.body.length).toBeGreaterThan(20);
    }
  });
});
