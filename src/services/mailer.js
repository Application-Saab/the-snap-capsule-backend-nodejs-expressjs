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

module.exports = { createMailer, otpEmail };
