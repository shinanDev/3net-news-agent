// Newsletter draft as a mail. Always writes data/out/<runId>.newsletter.eml (the exact mail),
// .newsletter.html (review copy with the logo as data URI) and .newsletter.txt.
// Sends via SMTP only when a host is configured, and only to localhost unless remote hosts are
// explicitly allowed: this prototype must never send real mail. No AUTH, no TLS (local catcher).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type { Brand } from "../../domain/brand.ts";
import type { Output, RunReport } from "../../ports/output.ts";
import { renderNewsletter, type NewsletterLanguage } from "./render.ts";

export interface SmtpSettings {
  host: string;
  port: number;
  /** NEWSLETTER_ALLOW_REMOTE: allow hosts other than localhost. Default false. */
  allowRemote: boolean;
}

/** Sends a finished raw message; injected in tests so no socket is opened. */
export type SendRaw = (smtp: SmtpSettings, envelope: { from: string; to: string }, raw: Buffer) => Promise<void>;

export interface NewsletterOptions {
  language: NewsletterLanguage;
  brand: Brand;
  from: string;
  to: string;
  logoPath: string;
  /** Unset: no mail is sent, only files are written. */
  smtp?: SmtpSettings;
  /** Default: data/out */
  outDir?: string;
  timeZone?: string;
  sendRaw?: SendRaw;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOGO_CID = "logo@3net-news-agent";

/** Throws unless the host is local or remote hosts are explicitly allowed. */
export function checkSmtpHost(host: string, allowRemote: boolean): void {
  if (LOCAL_HOSTS.has(host.trim().toLowerCase())) return;
  if (allowRemote) return;
  throw new Error(
    `SMTP host "${host}" refused: only localhost/127.0.0.1 are allowed (set NEWSLETTER_ALLOW_REMOTE=true to override)`,
  );
}

const smtpSendRaw: SendRaw = async (smtp, envelope, raw) => {
  const transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: false, ignoreTLS: true });
  try {
    await transport.sendMail({ envelope, raw });
  } finally {
    transport.close();
  }
};

export class NewsletterMailOutput implements Output {
  /** Paths written by the last render, and whether the mail was sent. */
  last: { eml: string; html: string; text: string; sent: boolean } | undefined;

  constructor(private readonly options: NewsletterOptions) {}

  async render(report: RunReport): Promise<void> {
    const o = this.options;
    // Guard first, before anything is composed or written.
    if (o.smtp) checkSmtpHost(o.smtp.host, o.smtp.allowRemote);

    const logo = await readFile(o.logoPath);
    const renderOptions = { language: o.language, brand: o.brand, ...(o.timeZone && { timeZone: o.timeZone }) };
    const mail = renderNewsletter(report, { ...renderOptions, logoSrc: `cid:${LOGO_CID}` });
    const review = renderNewsletter(report, { ...renderOptions, logoSrc: `data:image/png;base64,${logo.toString("base64")}` });

    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
    const info = await composer.sendMail({
      from: o.from,
      to: o.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [{ filename: "3net-logo.png", content: logo, cid: LOGO_CID, contentType: "image/png", contentDisposition: "inline" }],
    });
    const raw = info.message as Buffer;

    const dir = o.outDir ?? join("data", "out");
    await mkdir(dir, { recursive: true });
    const base = join(dir, `${report.runId}.newsletter`);
    const paths = { eml: `${base}.eml`, html: `${base}.html`, text: `${base}.txt` };
    await writeFile(paths.eml, raw);
    await writeFile(paths.html, review.html, "utf8");
    await writeFile(paths.text, mail.text, "utf8");

    let sent = false;
    if (o.smtp) {
      await (o.sendRaw ?? smtpSendRaw)(o.smtp, { from: o.from, to: o.to }, raw);
      sent = true;
    }
    this.last = { ...paths, sent };
  }
}
