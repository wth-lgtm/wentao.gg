import { getToken } from "next-auth/jwt";
import { google } from "googleapis";
import { NextResponse, type NextRequest } from "next/server";

// The access token is read straight out of the encrypted next-auth JWT here rather than
// off the session object, so it never has to be present in anything the browser can fetch.
export async function GET(req: NextRequest) {
  const token = await getToken({ req });
  const accessToken = typeof token?.accessToken === "string" ? token.accessToken : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: "v3", auth });

  try {
    const res = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: "files(id, name, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 50,
    });

    return NextResponse.json({ sheets: res.data.files ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Drive API error:", message);
    return NextResponse.json(
      { error: "Failed to list sheets" },
      { status: 500 }
    );
  }
}
