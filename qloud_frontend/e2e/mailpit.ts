import { expect, request, type APIRequestContext } from '@playwright/test';

// Django's E2E settings send email to the Mailpit from docker compose.
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitSearch {
  messages: { ID: string }[];
}

async function findLink(
  api: APIRequestContext,
  to: string,
  pathPrefix: string,
): Promise<string | undefined> {
  const search = await api.get('/api/v1/search', {
    params: { query: `to:"${to}"` },
  });
  for (const { ID } of ((await search.json()) as MailpitSearch).messages) {
    const message = await api.get(`/api/v1/message/${ID}`);
    const { Text } = (await message.json()) as { Text: string };
    const link = Text.split(/\s+/).find(
      (word) =>
        URL.canParse(word) && new URL(word).pathname.startsWith(pathPrefix),
    );
    if (link) return link;
  }
  return undefined;
}

/**
 * The link to `pathPrefix` in an email sent to `to`, waiting for it to arrive.
 * Every test uses its own random address, so tests never read each other's mail.
 */
export async function linkFromEmail(
  to: string,
  pathPrefix: string,
): Promise<string> {
  const api = await request.newContext({ baseURL: MAILPIT_URL });
  try {
    let link: string | undefined;
    await expect
      .poll(
        async () => {
          link = await findLink(api, to, pathPrefix);
          return link;
        },
        { message: `email to ${to} with a ${pathPrefix} link` },
      )
      .toBeDefined();
    return String(link);
  } finally {
    await api.dispose();
  }
}
