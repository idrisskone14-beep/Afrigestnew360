import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { LoginError, SESSION_MAX_AGE_SECONDS, authenticateCredentials } from "./login";

class AuthFailure extends CredentialsSignin {
  constructor(code: string) {
    super();
    this.code = code;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/connexion" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, totp: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new AuthFailure("invalid_credentials");
        try {
          const ok = await authenticateCredentials({
            ...parsed.data,
            totp: parsed.data.totp || undefined,
            ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
            userAgent: request.headers.get("user-agent"),
          });
          return { id: ok.userId, name: ok.name, email: ok.email, sid: ok.sessionId };
        } catch (e) {
          if (e instanceof LoginError) throw new AuthFailure(e.reason);
          throw e;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sid = user.sid;
      }
      return token;
    },
    session({ session, token }) {
      session.sid = token.sid as string | undefined;
      if (session.user) session.user.id = token.uid as string;
      return session;
    },
  },
});
