import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Country to emoji mapping
const countryEmojis: Record<string, string> = {
  US: "🇺🇸", CA: "🇨🇦", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", JP: "🇯🇵", CN: "🇨🇳",
  KR: "🇰🇷", AU: "🇦🇺", BR: "🇧🇷", IN: "🇮🇳", MX: "🇲🇽", ES: "🇪🇸", IT: "🇮🇹",
  NL: "🇳🇱", SE: "🇸🇪", NO: "🇳🇴", DK: "🇩🇰", FI: "🇫🇮", PL: "🇵🇱", RU: "🇷🇺",
  SG: "🇸🇬", HK: "🇭🇰", TW: "🇹🇼", NZ: "🇳🇿", IE: "🇮🇪", CH: "🇨🇭", AT: "🇦🇹",
  BE: "🇧🇪", PT: "🇵🇹", AR: "🇦🇷", CL: "🇨🇱", CO: "🇨🇴", TH: "🇹🇭", VN: "🇻🇳",
  PH: "🇵🇭", ID: "🇮🇩", MY: "🇲🇾", ZA: "🇿🇦", AE: "🇦🇪", IL: "🇮🇱", TR: "🇹🇷",
};

// US state codes to names
const usStates: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "Washington D.C.",
};

// Country codes to names
const countryNames: Record<string, string> = {
  CA: "Canada", GB: "United Kingdom", DE: "Germany", FR: "France", JP: "Japan", CN: "China",
  KR: "South Korea", AU: "Australia", BR: "Brazil", IN: "India", MX: "Mexico", ES: "Spain",
  IT: "Italy", NL: "Netherlands", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland",
  PL: "Poland", RU: "Russia", SG: "Singapore", HK: "Hong Kong", TW: "Taiwan", NZ: "New Zealand",
  IE: "Ireland", CH: "Switzerland", AT: "Austria", BE: "Belgium", PT: "Portugal",
  AR: "Argentina", CL: "Chile", CO: "Colombia", TH: "Thailand", VN: "Vietnam",
  PH: "Philippines", ID: "Indonesia", MY: "Malaysia", ZA: "South Africa", AE: "UAE", IL: "Israel", TR: "Turkey",
};

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  // Get geolocation data from Vercel headers (city may be URL-encoded)
  // Note: IP geolocation has inherent accuracy limitations - ISPs often register
  // IPs to data centers rather than actual user locations
  const country = request.headers.get("x-vercel-ip-country") || "";
  const region = request.headers.get("x-vercel-ip-country-region") || "";
  const rawCity = request.headers.get("x-vercel-ip-city") || "";
  const city = rawCity ? decodeURIComponent(rawCity) : "";

  // Visitor's own IP + approximate coordinates (Vercel edge headers). Echoed back to
  // that visitor only (client-side) for the "how do you know that?!" delight moment —
  // never stored, never exposed to anyone else. x-forwarded-for holds the client first.
  const fwd = request.headers.get("x-forwarded-for") || "";
  const rawIp = fwd.split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  const ip = rawIp.replace(/^::ffff:/, ""); // unwrap IPv4-mapped IPv6
  const lat = request.headers.get("x-vercel-ip-latitude") || "";
  const lon = request.headers.get("x-vercel-ip-longitude") || "";

  // Build location data. No `timePeriod`: the edge used to read x-vercel-ip-timezone and
  // build an Intl.DateTimeFormat on EVERY request to / to bucket the visitor's local hour,
  // and nothing ever read the result — the card and the greeting both ignore it.
  const countryEmoji = countryEmojis[country] || "";
  const countryName = country === "US" ? "USA" : (countryNames[country] || country);

  // Build granular location string: City, State/Region, Country + Flag
  const locationParts: string[] = [];

  if (city) {
    locationParts.push(city);
  }

  if (region) {
    // Convert US state codes to full names, keep other regions as-is
    const regionName = country === "US" ? (usStates[region] || region) : region;
    locationParts.push(regionName);
  }

  if (countryName) {
    locationParts.push(countryName);
  }

  // Join location parts with commas and add flag
  let locationString = locationParts.join(", ");
  if (countryEmoji) {
    locationString = locationString ? `${locationString} ${countryEmoji}` : countryEmoji;
  }

  // Send structured data as JSON for client-side greeting generation
  const greetingData = JSON.stringify({
    location: locationString,
    city, // raw city (may be "") — lets the client tell "real city" from "country only"
    cc: country, // ISO country code — lets the card pick miles vs km before /api/geo answers
    ip,
    lat,
    lon,
  });

  // Set cookie for client to read
  response.cookies.set("visitor-greeting-data", greetingData, {
    maxAge: 60 * 60, // 1 hour
    path: "/",
  });

  return response;
}

export const config = {
  matcher: ["/"],
};
