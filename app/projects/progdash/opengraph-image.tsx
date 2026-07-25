import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "../../lib/ogCard";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "ProgDash — read your lifting program straight from Google Sheets";

export default function Image() {
  return renderOgCard({
    title: "ProgDash",
    subtitle: "Your lifting program, straight from Google Sheets",
    footer: "WENTAO.GG",
  });
}
