import { isSynthetic, SYNTHETIC_BANNER_TEXT } from "../lib/synthetic.js";

export default function SyntheticBanner({ meta }) {
  if (!isSynthetic(meta)) return null;
  return <div className="synthetic-banner" role="alert">{SYNTHETIC_BANNER_TEXT}</div>;
}
