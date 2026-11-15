import { useEffect, useState } from "react";

const readTheme = () => {
  try { return localStorage.getItem("theme"); } catch { return null; }
};

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// Light/dark switch. The choice is remembered per browser; with nothing stored the page is dark. (Charts are drawn for the
// dark background, so the light theme is a convenience, not the designed look.)
export default function ThemeButton() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const toggle = () => {
    const next = (theme ?? "dark") === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem("theme", next); } catch { /* private window: the choice just is not remembered */ }
  };
  return <button type="button" className="ghost" onClick={toggle}>Switch to {(theme ?? "dark") === "dark" ? "light" : "dark"} theme</button>;
}
