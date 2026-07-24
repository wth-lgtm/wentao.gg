import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          // drive.metadata.readonly — NOT drive.readonly. The only Drive call in the app
          // is files.list(fields: "files(id, name, modifiedTime)") to populate the picker;
          // nothing ever downloads a Drive file. drive.readonly would grant read access to
          // every file in the user's Drive, and it is a Google "restricted" scope.
          // Sheet CONTENTS come from spreadsheets.readonly via the Sheets API, below.
          scope:
            "openid email profile https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    // NOTE: there is deliberately no `session` callback. Copying token.accessToken onto
    // the session object would publish a live Google bearer at GET /api/auth/session,
    // where any same-origin script could read it. The API routes that need the token
    // decrypt it server-side with getToken() instead.
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
