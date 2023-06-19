import puppeteer from 'puppeteer';
import { getEnvKey } from './lib/envkeys.mjs';
import { fetchProject } from './lib/project.mjs';
import { convertSessionToCalendarEntry } from './lib/calendar.mjs';
import { todoStrings } from './lib/todoStrings.mjs';

async function main(sessionNumber) {
  // First, retrieve known information about the project and the session
  const PROJECT_OWNER = await getEnvKey('PROJECT_OWNER');
  const PROJECT_NUMBER = await getEnvKey('PROJECT_NUMBER');
  const CALENDAR_SERVER = await getEnvKey('CALENDAR_SERVER', 'www.w3.org');
  console.log();
  console.log(`Retrieve project ${PROJECT_OWNER}/${PROJECT_NUMBER}...`);
  const project = await fetchProject(PROJECT_OWNER, PROJECT_NUMBER);
  const session = project.sessions.find(s => s.number === sessionNumber);
  if (!project) {
    throw new Error(`Project ${PROJECT_OWNER}/${PROJECT_NUMBER} could not be retrieved`);
  }
  if (!session) {
    throw new Error(`Session ${sessionNumber} not found in project ${PROJECT_OWNER}/${PROJECT_NUMBER}`);
  }
  console.log(`Retrieve project ${PROJECT_OWNER}/${PROJECT_NUMBER}... done`);

  console.log();
  console.log('Launch Puppeteer...');
  const browser = await puppeteer.launch({ headless: false });
  console.log('Launch Puppeteer... done');

  try {
    console.log();
    console.log('Fill calendar entry...')
    await convertSessionToCalendarEntry({
      browser, session, project,
      calendarServer: CALENDAR_SERVER,
      login: await getEnvKey('W3C_LOGIN'),
      password: await getEnvKey('W3C_PASSWORD')
    });
    console.log('Fill calendar entry... done');
  }
  finally {
    await browser.close();
  }
}


// Read session number from command-line
if (!process.argv[2] || !process.argv[2].match(/^\d+$/)) {
  console.log('Command needs to receive a session number as first parameter');
  process.exit(1);
}
const sessionNumber = parseInt(process.argv[2], 10);

main(sessionNumber)
  .catch(err => {
    console.log(`Something went wrong: ${err.message}`);
  });