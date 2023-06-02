/**
 * Wrapper function to send an GraphQL request to the GitHub GraphQL endpoint,
 * authenticating using either a token read from the environment (typically
 * useful when code is run within a GitHub job) or from a `config.json` file in
 * the root folder of the repository (typically useful for local runs).
 *
 * Function throws if the personal access token is missing.
 */
export async function sendGraphQLRequest(query) {
  const GRAPHQL_TOKEN = await getAccessToken();  
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `bearer ${GRAPHQL_TOKEN}`,
    },
    body: JSON.stringify({ query }, null, 2)
  });
  if (res.status !== 200) {
    if (res.status >= 500) {
      throw new Error(`GraphQL server error, ${res.status} status received`);
    }
    if (res.status === 403) {
      throw new Error(`GraphQL server reports that the API key is invalid, ${res.status} status received`);
    }
    throw new Error(`GraphQL server returned an unexpected HTTP status ${res.status}`);
  }
  return await res.json();
}


/**
 * Inner function to retrieve the personal access token from the environment or
 * from the `config.json` file.
 */
async function getAccessToken() {
  // Retrieve Personal Access Token from local config file
  // or from the environment
  if (process.env.GRAPHQL_TOKEN) {
    return process.env.GRAPHQL_TOKEN;
  }
  try {
    const { default: env } = await import(
      '../../config.json',
      { assert: { type: 'json' } }
    );
    return env.GRAPHQL_TOKEN;
  } catch {
    throw new Error('No GRAPHQL_TOKEN token found in environment or config file.');
  }
}
