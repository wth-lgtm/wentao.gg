// X/Twitter reads its own convention rather than falling back to opengraph-image, so
// point it at the identical renderer instead of maintaining a second design.
export { default, size, contentType, alt } from "./opengraph-image";
