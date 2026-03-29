import fs from 'fs-extra';

type YtDlpFlags = Record<string, any>;

interface DownloadWithFallbackOptions {
  cookieFile?: string;
  cookieContents?: string;
  context?: string;
  isYoutube?: boolean;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export function buildYtDlpBaseFlags(flags: YtDlpFlags = {}): YtDlpFlags {
  const headers = Array.isArray(flags.addHeader) ? [...flags.addHeader] : [];

  if (!headers.some((header) => String(header).toLowerCase().startsWith('accept-language:'))) {
    headers.push('accept-language:zh-CN,zh;q=0.9,en;q=0.8');
  }

  return {
    noCheckCertificates: true,
    forceIpv4: true,
    retries: 3,
    fragmentRetries: 3,
    fileAccessRetries: 3,
    socketTimeout: 30,
    jsRuntimes: process.env.YTDLP_JS_RUNTIMES || 'node,deno',
    userAgent: flags.userAgent || process.env.YTDLP_USER_AGENT || DEFAULT_USER_AGENT,
    addHeader: headers,
    ...flags,
  };
}

export async function downloadWithYtDlpFallback(
  youtubedl: (url: string, flags: YtDlpFlags) => Promise<any>,
  url: string,
  flags: YtDlpFlags,
  options: DownloadWithFallbackOptions = {},
): Promise<void> {
  const { cookieContents, cookieFile, context = 'yt-dlp', isYoutube = false } = options;
  const baseFlags = buildYtDlpBaseFlags(flags);
  const attempts: Array<{ label: string; flags: YtDlpFlags }> = [];

  if (isYoutube && cookieContents && cookieFile) {
    await fs.writeFile(cookieFile, cookieContents.replace(/\\n/g, '\n'));
    attempts.push({
      label: 'with cookies',
      flags: { ...baseFlags, cookies: cookieFile },
    });
  }

  attempts.push({
    label: attempts.length > 0 ? 'without cookies' : 'default',
    flags: baseFlags,
  });

  let lastError: any;

  for (const attempt of attempts) {
    try {
      console.log(`[yt-dlp] ${context}: starting ${attempt.label}`);
      await youtubedl(url, attempt.flags);
      if (attempt.label === 'without cookies' && attempts.length > 1) {
        console.warn(`[yt-dlp] ${context}: cookies were skipped after a failed authenticated attempt.`);
      }
      return;
    } catch (error: any) {
      lastError = error;
      console.warn(`[yt-dlp] ${context}: ${attempt.label} failed: ${error?.message || error}`);
    }
  }

  throw lastError;
}
