import { Router, Request, Response } from "express";
import { asyncHandler } from "../lib/errors.js";
import { AppError } from "../lib/errors.js";
import { sendVerificationEmail, verifyEmailToken } from "../lib/emailVerification.js";
import { rateLimiter } from "../middleware/rateLimiter.js";

const router = Router();

const PUBLIC_DOMAIN = process.env.PUBLIC_DOMAIN ?? "localhost:8080";

/** GET /api/auth/verify-email?token=xxx — consume token, redirect to dashboard */
router.get("/auth/verify-email", asyncHandler(async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  if (!token) throw AppError.badRequest("Missing token");

  const userId = await verifyEmailToken(token);
  if (!userId) {
    return res.redirect("/?error=invalid_or_expired_token");
  }

  // Redirect to dashboard with success banner
  res.redirect("/dashboard?email_verified=1");
}));

/** POST /api/auth/resend-verification — re-send verification email */
router.post(
  "/auth/resend-verification",
  rateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.isAuthenticated() || !req.user) throw AppError.unauthorized();
    const user = req.user as { id: string; email?: string; emailVerified?: number };

    if (user.emailVerified) {
      return res.json({ ok: true, message: "Email already verified." });
    }
    if (!user.email) throw AppError.badRequest("No email address on your account.");

    await sendVerificationEmail(user.id, user.email, PUBLIC_DOMAIN);
    res.json({ ok: true, message: "Verification email sent." });
  }),
);

export default router;
