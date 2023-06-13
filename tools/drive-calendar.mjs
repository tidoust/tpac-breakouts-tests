import puppeteer from 'puppeteer';
import { getEnvKey } from './lib/envkeys.mjs';
import { fetchProject } from './lib/project.mjs';
import { validateSession } from './lib/validate.mjs';

/**
 * Helper function to format calendar entry description from the session's info
 */
function formatDescription(session) {
  let materials = '';
  if (session.description.materials) {
    for (const [key, value] of Object.entries(session.description.materials)) {
      if ((key !== 'agenda') && (key !== 'calendar')) {
        materials += `- ${key}: ${value}\n`;
      }
    }
  }
  if (materials) {
    materials = `## Materials\n${materials}`;
  }
  return `## Description
${session.description.description}

## Goal(s)
${session.description.goal}

${materials}`;
}


/**
 * Login to W3C server
 */
async function authenticate(page, redirectUrl) {
  const W3C_USERNAME = await getEnvKey('W3C_USERNAME');
  const W3C_PASSWORD = await getEnvKey('W3C_PASSWORD');

  const usernameInput = await page.waitForSelector('input#username');
  await usernameInput.type(W3C_USERNAME);

  const passwordInput = await page.waitForSelector('input#password');
  await passwordInput.type(W3C_PASSWORD);

  const submitButton = await page.waitForSelector('button[type=submit]');
  await submitButton.click();

  await page.waitForNavigation();
  const url = await page.evaluate(() => window.location.href);
  if (url !== redirectUrl) {
    throw new Error('Could not login. Invalid credentials?');
  }
}

async function fillCalendarEntry(page, session, project) {
  async function selectEl(selector) {
    const el = await page.waitForSelector(selector);
    if (!el) {
      throw new Error(`No element in page that matches "${selector}"`);
    }
    return el;
  }
  async function fillTextInput(selector, value) {
    const el = await selectEl(selector);

    // Clear input (select all and backspace!)
    await el.click({ clickCount: 3 });
    await el.press('Backspace');

    if (value) {
      await el.type(value);
    }
  }
  async function clickOnInput(selector) {
    const el = await selectEl(selector);
    await el.click();
  }
  async function chooseOption(selector, value) {
    const el = await selectEl(selector);
    await el.select(value);
  }

  await fillTextInput('input#event_title', session.title);
  await clickOnInput('input#event_status_2'); // Status: confirmed
  await fillTextInput('textarea#event_description', formatDescription(session));
  await clickOnInput('input#event_visibility_' + (session.description.attendance === 'restricted' ? '1' : '0'));

  await page.evaluate(`window.tpac_breakouts_date = "${project.metadata.date}";`);
  await page.$eval('input#event_start_date', el => el.value = window.tpac_breakouts_date);
  await page.$eval('input#event_start_date', el => el.value = window.tpac_breakouts_date);

  const slot = project.slots.find(s => s.name === session.slot);
  await chooseOption('select#event_start_time_hour', `${parseInt(slot.start.split(':')[0], 10)}`);
  await chooseOption('select#event_start_time_minute', `${parseInt(slot.start.split(':')[1], 10)}`);
  await chooseOption('select#event_end_time_hour', `${parseInt(slot.end.split(':')[0], 10)}`);
  await chooseOption('select#event_end_time_minute', `${parseInt(slot.end.split(':')[1], 10)}`);

  await chooseOption('select#event_timezone', project.metadata.timezone);

  // TODO: add chairs as individual attendees by adding buttons:
  // <button id="event_individuals-input-remove-0" data-value="[w3c id]">[name]</button>

  await clickOnInput('input#event_joinVisibility_' + (session.description.attendance === 'restricted' ? '1' : '0'));

  await fillTextInput('input#event_joinLink', 'TODO: zoom');
  await fillTextInput('textarea#event_joiningInstructions', 'TODO: joining instructions');

  await fillTextInput('input#event_chat', `https://irc.w3.org/?channels=%23${session.shortname}`);
  await fillTextInput('input#event_agendaUrl', session.description.materials.agenda);
  await fillTextInput('input#event_minutesUrl', session.description.materials.minutes);

  // TODO: big meeting is "tpac2023", need to convert it to "15"...
  await chooseOption('select#event_big_meeting', '15');
  await chooseOption('select#event_category', 'breakout-sessions');
}


async function main(sessionNumber) {
  // First, retrieve known information about the project and the session
  const PROJECT_OWNER = await getEnvKey('PROJECT_OWNER');
  const PROJECT_NUMBER = await getEnvKey('PROJECT_NUMBER');
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

  const sessionErrors = (await validateSession(15, project))
    .filter(error => error.severity === 'error');
  if (sessionErrors.length > 0) {
    throw new Error(`Session ${sessionNumber} contains errors that need fixing`);
  }
  console.log(`Retrieve project ${PROJECT_OWNER}/${PROJECT_NUMBER}... done`);
  
  const calendarUrl = session.description.materials.calendar ?? undefined;
  const pageUrl = calendarUrl ?
    `${calendarUrl.replace(/www\.w3\.org/, 'beta.w3.org')}/edit/` :
    'https://beta.w3.org/events/meetings/new/';

  console.log();
  console.log('Launch Puppeteer and authenticate...');
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(pageUrl);
  await authenticate(page, pageUrl);
  console.log('Launch Puppeteer and authenticate... done');

  console.log();
  console.log('Fill calendar entry...');
  await fillCalendarEntry(page, session, project);
  console.log('Fill calendar entry... done');

  /*await page.close();
  await browser.close();*/
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
    throw err;
  });