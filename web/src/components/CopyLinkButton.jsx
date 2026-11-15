import { useState } from "react";

// Copies the address of this exact view. The area, the dates and the region are already kept in the address, so the link
// opens the same view for whoever receives it. Says plainly when the browser refuses to copy.
export default function CopyLinkButton() {
  const [msg, setMsg] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMsg("Link copied");
    } catch {
      setMsg("Could not copy. Copy the address from the browser bar.");
    }
    setTimeout(() => setMsg(""), 4000);
  };
  return (
    <>
      <button type="button" className="ghost" onClick={copy} title="Copy a link that reopens this region, area and dates">Copy link</button>
      <span className="hint copy-status" role="status">{msg}</span>
    </>
  );
}
