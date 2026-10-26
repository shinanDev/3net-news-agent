// Newsletter signature (NEWSLETTER_SIGNATURE_PATH, JSON) and partner badge
// (NEWSLETTER_PARTNER_LOGO_PATH, image). Both are optional and live outside the repository
// (data/brand/); config/signature.example.json shows the format with placeholders.
// Website and privacy link must be https URLs and the email a plain address, because they
// become links in the mail. Errors name the variable so a wrong path is easy to find.

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export interface Signature {
  companyName: string;
  partnerLine?: string;
  addressLine?: string;
  phone?: string;
  website?: string;
  email?: string;
  legalLines: string[];
  privacyUrl?: string;
}

export interface PartnerLogo {
  content: Buffer;
  contentType: string;
}

export const SIGNATURE_VARIABLE = "NEWSLETTER_SIGNATURE_PATH";
export const PARTNER_LOGO_VARIABLE = "NEWSLETTER_PARTNER_LOGO_PATH";

const TEXT_FIELDS = ["partnerLine", "addressLine", "phone"] as const;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif" };

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isPlainEmail(value: string): boolean {
  return EMAIL.test(value);
}

export async function loadSignature(path: string): Promise<Signature> {
  const fail = (reason: string) => new Error(`${SIGNATURE_VARIABLE}: ${path}: ${reason}`);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw fail(`cannot read the file (${(err as NodeJS.ErrnoException).code ?? String(err)})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw fail("not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw fail("expected a JSON object");
  const v = raw as Record<string, unknown>;
  const known = ["companyName", ...TEXT_FIELDS, "website", "email", "legalLines", "privacyUrl"];
  const extra = Object.keys(v).filter((k) => !known.includes(k));
  if (extra.length) throw fail(`unknown fields: ${extra.join(", ")}`);

  if (typeof v["companyName"] !== "string" || !v["companyName"].trim()) throw fail("companyName must be a non-empty string");
  const signature: Signature = { companyName: v["companyName"].trim(), legalLines: [] };
  const optional = (key: string): string | undefined => {
    const value = v[key];
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string") throw fail(`${key} must be a string`);
    return value.trim() || undefined;
  };
  for (const key of TEXT_FIELDS) {
    const value = optional(key);
    if (value) signature[key] = value;
  }
  for (const key of ["website", "privacyUrl"] as const) {
    const value = optional(key);
    if (value === undefined) continue;
    if (!isHttpsUrl(value)) throw fail(`${key} must be an https:// URL`);
    signature[key] = value;
  }
  const email = optional("email");
  if (email !== undefined) {
    if (!isPlainEmail(email)) throw fail("email must be a plain address like name@example.com");
    signature.email = email;
  }
  const legal = v["legalLines"];
  if (legal !== undefined) {
    if (!Array.isArray(legal) || !legal.every((l) => typeof l === "string")) throw fail("legalLines must be an array of strings");
    signature.legalLines = legal.map((l) => l.trim()).filter(Boolean);
  }
  return signature;
}

export async function loadPartnerLogo(path: string): Promise<PartnerLogo> {
  const contentType = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!contentType) throw new Error(`${PARTNER_LOGO_VARIABLE}: ${path}: use a .png, .jpg or .gif file`);
  try {
    return { content: await readFile(path), contentType };
  } catch (err) {
    throw new Error(`${PARTNER_LOGO_VARIABLE}: ${path}: cannot read the file (${(err as NodeJS.ErrnoException).code ?? String(err)})`);
  }
}

/** Loads what the configuration names; nothing when the paths are not set. */
export async function loadNewsletterExtras(paths: { signaturePath?: string; partnerLogoPath?: string }): Promise<{
  signature?: Signature;
  partnerLogo?: PartnerLogo;
}> {
  return {
    ...(paths.signaturePath && { signature: await loadSignature(paths.signaturePath) }),
    ...(paths.partnerLogoPath && { partnerLogo: await loadPartnerLogo(paths.partnerLogoPath) }),
  };
}
