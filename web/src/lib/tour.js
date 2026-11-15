// Steps of the guided walkthrough. Each points at a real part of the page by CSS selector. A step may name a collapsed
// section to open first (`opens`, a selector for a details element), and the page it lives on (`view`, default "workbench"). A step whose target never appears is skipped.
// Wording is plain on purpose and repeats the data's limits where they matter.
export const TOUR_STEPS = [
  { selector: ".region-select", title: "Pick a region",
    body: "Each region has its own record. Choosing one resets the area and the dates to the whole region." },
  { selector: '[aria-label="Area and dates"]', title: "Choose the area and the dates",
    body: "Set the period, then draw a rectangle or a polygon on the map, or type coordinates. Everything on the page follows the area you choose." },
  { selector: '[aria-label="Map"]', title: "Detections on the map",
    body: "Each square is one 0.25 degree cell with detections in the month you choose. Brighter means more. Drag the slider, or jump to the busiest month. The 3D globe tab shows the same detections on a globe." },
  { selector: '[aria-label="Summary"]', title: "The headline numbers",
    body: "The first number says whether the latest month is high or low for this time of year. The others give the totals, the busiest month and year, and how many months are model estimates rather than satellite counts." },
  { selector: '[aria-label="Calendar heatmap"]', title: "The burning activity calendar",
    body: "Years run across, months down. Diagonal lines are MODIS estimates, dots are provisional months, and the white line marks the switch to VIIRS. The pink outlines are the five highest months. Hover or focus a cell for its range." },
  { selector: '[aria-label="Latest month against baseline"]', title: "Is it unusual right now?",
    body: "The latest month against the median of the same calendar month in the baseline years you choose, with its percentile." },
  { selector: '[aria-label="Results at a glance"]', view: "results", title: "Results in plain words",
    body: "What we did, what it shows for the area you chose, and how to read each graph. Every number here is computed from the data on screen." },
  { selector: '[aria-label="Choose the two areas"]', view: "compare", title: "Compare two areas",
    body: "Area A is the area you chose. Type the corners of an Area B inside the same region to see both side by side: totals with ranges, fire seasons, and whether the two areas burn in the same years." },
  { selector: '[data-details="export"]', opens: '[data-details="export"]', title: "Take it with you",
    body: "Download the numbers as CSV, any chart as an image, or get the PDF report with the key figures and the limits of the data." },
];

// Where to put the explanation card next to the highlighted element.
//   rect: the element's box in viewport pixels { top, left, width, height }
//   size: the card's { w, h } (its measured height, not a guess), view: the viewport { w, h }
// Prefers below the element, then above; if the element is too tall for either, the card sits at the bottom
// of the screen. Always stays fully inside the viewport horizontally.
export function placePopover(rect, size, view, gap = 12, margin = 8) {
  const left = Math.max(margin, Math.min(rect.left, view.w - size.w - margin));
  const below = rect.top + rect.height + gap;
  if (below + size.h + margin <= view.h) return { top: below, left, placement: "below" };
  const above = rect.top - gap - size.h;
  if (above >= margin) return { top: above, left, placement: "above" };
  // Whatever the card's height, it never runs off the bottom of the screen (its buttons would be unreachable).
  return { top: Math.max(margin, view.h - size.h - margin), left, placement: "bottom" };
}
