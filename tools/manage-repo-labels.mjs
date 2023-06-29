/**
 * This tool adjusts the list of labels defined in the given repository so
 * that it may be used as a breakout sessions repository
 *
 * To run the tool:
 *
 *  node tools/manage-repo-labels.mjs [repo owner] [repo name]
 *
 * The tool adds labels needed by the session validation logic. It also gets
 * rid of labels that should be useless (but note it preserves "track: xxx"
 * labels), and updates labels that don't have the right description or color.
 *
 * Essentially, this tool should be run once when the annual repository is
 * created, and each time changes are made to the list of labels below.
 */

import { sendGraphQLRequest } from './lib/graphql.mjs';

const labels = [
  {
    "name": "check: instructions",
    "description": "Proposal has instructions for meeting planners. Remove label once they have been checked.",
    "color": "1D76DB"
  },
  {
    "name": "error: chair conflict",
    "description": "Session scheduled at the same time as another session with an overlapping chair",
    "color": "B60205"
  },
  {
    "name": "error: chairs",
    "description": "Cannot retrieve the W3C account of a session chair",
    "color": "B60205"
  },
  {
    "name": "error: conflict",
    "description": "Conflicting issue is not a breakout session proposal",
    "color": "B60205"
  },
  {
    "name": "error: format",
    "description": "Issue cannot be parsed by automatic job due to some formatting issue",
    "color": "B60205"
  },
  {
    "name": "error: scheduling",
    "description": "Session scheduled in same room and at the same time as another session",
    "color": "B60205"
  },
  {
    "name": "session",
    "description": "Breakout session proposal",
    "color": "C2E0C6"
  },
  {
    "name": "warning: agenda",
    "description": "No agenda link whereas session is around the corner (or past already)",
    "color": "FBCA04"
  },
  {
    "name": "warning: capacity",
    "description": "Session room is smaller than requested capacity",
    "color": "FBCA04"
  },
  {
    "name": "warning: conflict",
    "description": "Session scheduled at the same time as another session identified as conflicting",
    "color": "FBCA04"
  },
  {
    "name": "warning: duration",
    "description": "Session scheduled during a 30mn slot but 60mn was preferred",
    "color": "FBCA04"
  },
  {
    "name": "warning: minutes",
    "description": "No link to the minutes whereas session is past",
    "color": "FBCA04"
  },
  {
    "name": "warning: minutes origin",
    "description": "Minutes are not stored on www.w3.org",
    "color": "FBCA04"
  },
  {
    "name": "warning: track",
    "description": "Session scheduled at the same time as another session in the same track",
    "color": "FBCA04"
  }
];

async function createRepoLabels(owner, repo) {
  console.log('Retrieve repository information...');
  const res = await sendGraphQLRequest(`query {
    repository(owner: "${owner}", name: "${repo}") {
      id
      labels(first: 100) {
        nodes {
          id
          name
          description
          color
        }
      }
    }
  }`);
  const repositoryId = res.data.repository.id;
  const repositoryLabels = res.data.repository.labels.nodes
    .sort((l1, l2) => l1.name.localeCompare(l2.name));
  console.log(`- repository id: ${repositoryId}`);
  console.log(`- repository labels:\n    ${repositoryLabels.map(l => l.name).join('\n    ')}`);
  console.log('Retrieve repository information... done');

  // Mutation commands on labels are in preview as of 2023-06-10:
  // https://docs.github.com/en/graphql/overview/schema-previews#labels-preview
  const labelsPreviewHeader = 'application/vnd.github.bane-preview+json';

  console.log();
  console.log('Add labels as needed...');
  const labelsToAdd = labels
    .filter(label => !repositoryLabels.find(l => l.name === label.name));
  for (const label of labelsToAdd) {
    console.log(`- add ${label.name}`);
    const res = await sendGraphQLRequest(`mutation {
        createLabel(input: {
          repositoryId: "${repositoryId}",
          name: "${label.name}",
          color: "${label.color}",
          description: "${label.description}",
          clientMutationId: "mutatis mutandis"
        }) {
          label {
            id
          }
        }
      }`, labelsPreviewHeader);
    if (!res?.data?.createLabel?.label?.id) {
      console.log(JSON.stringify(res, null, 2));
      throw new Error(`GraphQL error, could not create label ${label.name}`);
    }
  }
  console.log('Add labels as needed... done');

  console.log();
  console.log('Delete labels as needed...');
  const labelsToDelete = repositoryLabels
    .filter(label =>
      !labels.find(l => l.name === label.name) &&
      !label.name.startsWith('track: '));
  for (const label of labelsToDelete) {
    console.log(`- delete ${label.name}`);
    const res = await sendGraphQLRequest(`mutation {
        deleteLabel(input: {
          id: "${label.id}",
          clientMutationId: "mutatis mutandis"
        }) {
          clientMutationId
        }
      }`, labelsPreviewHeader);
    if (!res?.data?.deleteLabel?.clientMutationId) {
      console.log(JSON.stringify(res, null, 2));
      throw new Error(`GraphQL error, could not delete label ${label.name}`);
    }
  }
  console.log('Delete labels as needed... done');

  console.log();
  console.log('Update labels as needed...');
  const labelsToUpdate = repositoryLabels
    .filter(label => labels.find(l => l.name === label.name))
    .filter(label => {
      const refLabel = labels.find(l => l.name === label.name);
      return (refLabel.description !== label.description) ||
        (refLabel.color !== label.color);
    });
  for (const label of labelsToUpdate) {
    console.log(`- update ${label.name}`);
    const res = await sendGraphQLRequest(`mutation {
        updateLabel(input: {
          id: "${label.id}",
          name: "${label.name}",
          color: "${label.color}",
          description: "${label.description}",
          clientMutationId: "mutatis mutandis"
        }) {
          label {
            id
          }
        }
      }`, labelsPreviewHeader);
    if (!res?.data?.updateLabel?.label?.id) {
      console.log(JSON.stringify(res, null, 2));
      throw new Error(`GraphQL error, could not update label ${label.name}`);
    }
  }
  console.log('Update labels as needed... done');
}

// Read session number from command-line
if (!process.argv[2]) {
  console.log('Command needs to receive a repo owner as first parameter');
  process.exit(1);
}
if (!process.argv[3]) {
  console.log('Command needs to receive a repo name as second parameter');
  process.exit(1);
}

const owner = process.argv[2];
const repo = process.argv[3];

createRepoLabels(owner, repo)
  .catch(err => {
    console.log(`Something went wrong: ${err.message}`);
    throw err;
  });