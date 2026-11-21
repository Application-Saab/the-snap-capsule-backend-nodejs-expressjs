const nodemailer = require("nodemailer");

function otpEmail(code, ttlMinutes) {
  const text = [
    `Your Snap Capsule login code is ${code}.`,
    ``,
    `It expires in ${ttlMinutes} minutes. If you didn't try to sign in, you can ignore this email.`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;background:#faf7fc;font-family:Arial,Helvetica,sans-serif;color:#1e0756">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;background:#ffffff;border-radius:16px;padding:32px 24px">
        <tr><td style="font-size:20px;font-weight:bold;color:#97538c">Snap Capsule</td></tr>
        <tr><td style="padding-top:20px;font-size:15px;line-height:22px;color:#494949">Use this code to sign in:</td></tr>
        <tr><td style="padding:16px 0;font-size:34px;font-weight:bold;letter-spacing:8px;color:#1e0756">${code}</td></tr>
        <tr><td style="font-size:13px;line-height:20px;color:#61677c">It expires in ${ttlMinutes} minutes. If you didn't try to sign in, you can ignore this email.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject: `${code} is your Snap Capsule login code`, text, html };
}

/**
 * Sends login-code emails over SMTP. Without SMTP_HOST (development only;
 * production requires it) codes are printed to the server console.
 */
function createMailer(config) {
  if (!config.SMTP_HOST) {
    return {
      transport: "console",
      async sendOtp(email, code, ttlMinutes) {
        console.log(`[dev] Login code for ${email}: ${code} (valid ${ttlMinutes} min). Set SMTP_* to send real emails.`);
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });

  return {
    transport: "smtp",
    async sendOtp(email, code, ttlMinutes) {
      const { subject, text, html } = otpEmail(code, ttlMinutes);
      await transporter.sendMail({ from: config.MAIL_FROM, to: email, subject, text, html });
    },
    verify: () => transporter.verify(),
  };
}

/** A plain-language hint for common SMTP errors (for logs). */
function smtpHint(err) {
  const msg = `${err && err.code ? err.code : ""} ${err && err.message ? err.message : ""}`;
  if (/EAUTH|535|Username and Password not accepted|Invalid login/i.test(msg)) {
    return "SMTP_USER / SMTP_PASS were rejected. For Google Workspace use a 16-character app password (not the normal password); for Resend use SMTP_USER=resend and the API key.";
  }
  if (/ETIMEDOUT|ECONNREFUSED|ECONNECTION|ESOCKET|ENOTFOUND|EDNS/i.test(msg)) {
    return "Couldn't reach the SMTP server. Check SMTP_HOST/SMTP_PORT; if port 465 is blocked on this network, try SMTP_PORT=587 with SMTP_SECURE=false.";
  }
  if (/wrong version number|SSL routines|EPROTO/i.test(msg)) {
    return "SMTP_SECURE doesn't match the port: use SMTP_SECURE=true with 465, or SMTP_SECURE=false with 587.";
  }
  if (/domain|not verified|sender|from address/i.test(msg)) {
    return "The sender in MAIL_FROM isn't allowed. Verify the domain with your email provider, or use the account's own address.";
  }
  return "";
}

module.exports = { createMailer, otpEmail, smtpHint };
