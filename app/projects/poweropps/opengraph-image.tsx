import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE } from "../../lib/ogCard";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "PowerOPPS — powerlifting index calculator";

export default function Image() {
  return renderOgCard({
    title: "PowerOPPS",
    subtitle: "Powerlifting index calculator · DOTS, IPF, Wilks",
    footer: "WENTAO.GG",
  });
}
