import { getEnvKey } from './envkeys.mjs';


/**
 * Internal memory cache to avoid sending the same request more than once
 * (same author may be associated with multiple sessions!)
 */
const cache = {};


/**
 * Return the W3C account linked to the requested person, identified by their
 * GitHub identity or their W3C hash
 *
 * Note: the function takes a `databaseId` identifier (returned by GitHub)
 * because users may update their `login` on GitHub at any time.
 */
export async function fetchW3CAccount({ databaseId, w3cHash }) {
  // Only fetch accounts once
  const cacheKey = databaseId ? `g-${databaseId}` : `w-${w3cHash}`;
  if (cache[cacheKey]) {
    return Object.assign({}, cache[cacheKey]);
  }

  async function fetchFromW3CAPI(url) {
    const W3C_API_KEY = await getEnvKey('W3C_API_KEY');
    const requestOptions = {
      headers: {
        Authorization: `W3C-API apikey="${W3C_API_KEY}"`
      }
    };

    const res = await fetch(
      `https://api.w3.org/users/connected/github/${databaseId}`,
      requestOptions
    );

    if (res.status !== 200) {
      if (res.status >= 500) {
        throw new Error(`W3C API server error, ${res.status} status received`);
      }
      if (res.status === 403) {
        throw new Error(`W3C API server reports that the API key is invalid, ${res.status} status received`);
      }
      if (res.status !== 404) {
        throw new Error(`W3C API server returned an unexpected HTTP status ${res.status}`);
      }
      return;
    }

    const json = await res.json();
    const user = {
      w3cId: json.id,
      name: json.name
    };
    if (json.email) {
      user.email = json.email;
    };
    if (databaseId) {
      user.githubId = databaseId;
    }
    return user;
  }

  let user;
  if (databaseId) {
    user = await fetchFromW3CAPI(`https://api.w3.org/users/connected/github/${databaseId}`);
  }
  if (!user && w3cHash) {
    user = await fetchFromW3CAPI(`https://api.w3.org/users/${w3cHash}`);
  }
  cache[cacheKey] = user;
  return user;
}
