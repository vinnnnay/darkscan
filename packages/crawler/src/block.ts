const BLOCK_PHRASES =
  /captcha|are you (a )?(human|robot)|verify (that )?you('re| are) (a )?human|unusual traffic|access denied|request (was )?blocked|automated (access|queries)|pardon our interruption|checking your browser|security check/i;

const CONNECTION_REFUSED = /ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|ERR_ACCESS_DENIED|ERR_SSL_PROTOCOL_ERROR/;

/**
 * Bot protection often drops the connection instead of showing a block page. Returns a
 * reason when a navigation error looks like that, so it is reported as "not auditable".
 */
export function detectRefusal(errorMessage: string): string | null {
  const code = CONNECTION_REFUSED.exec(errorMessage)?.[0];
  return code ? `the site closed the connection (${code}), which is typical of bot protection` : null;
}

/**
 * Recognises a bot check or block page. DarkScan never solves CAPTCHAs or works around
 * blocks: a site that shows one is reported "not auditable" and left alone.
 * Block pages are short, so a phrase only counts on a page with little text.
 */
export function detectBlock(status: number, visibleText: string): string | null {
  if (status === 429) return "HTTP 429: the site is rate limiting this crawler";
  if (status === 403) return "HTTP 403: the site refused access";
  const text = visibleText.trim();
  const phrase = BLOCK_PHRASES.exec(text)?.[0];
  if (phrase && text.length < 2500) return `bot check or block page (“${phrase}”)`;
  return null;
}
