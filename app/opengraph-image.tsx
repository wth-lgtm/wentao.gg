import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "./lib/ogCard";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "wentao.GG — Wentao He, engineer and developer";

export default function Image() {
  return renderOgCard({
    title: "wentao.GG",
    subtitle: "Engineering Lead at Mercor · Applied AI",
  });
}
