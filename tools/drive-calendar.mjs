import puppeteer from 'puppeteer';
import { getEnvKey } from './lib/envkeys.mjs';
import { fetchProject } from './lib/project.mjs';
import { validateSession } from './lib/validate.mjs';
import { todoStrings } from './lib/todoStrings.mjs';

/**
 * Helper function to format calendar entry description from the session's info
 */
function formatDescription(session) {
  const issueUrl = `https://github.com/${session.repository}/issues/${session.number}`;
  const materials = Object.entries(session.description.materials || [])
    .filter(([key, value]) => (key !== 'agenda') && (key !== 'calendar'))
    .filter(([key, value]) => !todoStrings.includes(value))
    .map(([key, value]) => `- [${key}](${value})`);
  materials.push(`- [GitHub issue](${issueUrl})`);

  return `## Description
${session.description.description}

## Goal(s)
${session.description.goal}

## Materials
${materials.join('\n')}`;
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

async function assessCalendarEntry(page, session) {
  const issueUrl = `https://github.com/${session.repository}/issues/${session.number}`;
  await page.evaluate(`window.tpac_breakouts_issueurl = "${issueUrl}";`);
  const desc = await page.$eval('textarea#event_description', el => el.value);
  if (!desc) {
    throw new Error('No calendar entry description');
  }
  if (!desc.contains(`- [GitHub issue](${issueUrl}`)) {
    throw new Error('Calendar entry does not link back to GitHub issue');
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
  async function clickOnElement(selector) {
    const el = await selectEl(selector);
    await el.click();
  }
  async function chooseOption(selector, value) {
    const el = await selectEl(selector);
    await el.select(value);
  }

  await fillTextInput('input#event_title', session.title);
  await clickOnElement('input#event_status_2'); // Status: confirmed
  await fillTextInput('textarea#event_description', formatDescription(session));
  await clickOnElement('input#event_visibility_' + (session.description.attendance === 'restricted' ? '1' : '0'));

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

  await clickOnElement('input#event_joinVisibility_' + (session.description.attendance === 'restricted' ? '1' : '0'));

  await fillTextInput('input#event_joinLink', 'TODO: zoom');
  await fillTextInput('textarea#event_joiningInstructions', 'TODO: joining instructions');

  await fillTextInput('input#event_chat', `https://irc.w3.org/?channels=%23${session.shortname}`);
  await fillTextInput('input#event_agendaUrl', session.description.materials.agenda);
  await fillTextInput('input#event_minutesUrl', session.description.materials.minutes);

  // Big meeting is "TPAC 2023", not the actual option value
  await page.evaluate(`window.tpac_breakouts_meeting = "${project.metadata.meeting}";`);
  await page.$$eval('select#event_big_meeting option', el =>
    el.selected = el.innerText.startsWith(window.tpac_breakouts_meeting));
  await chooseOption('select#event_category', 'breakout-sessions');

  // Click on "Create/Update but don't send notifications" button
  // and return URL of the calendar entry
  await clickOnElement('button#event_no_notif');
  await page.waitForNavigation();
  const calendarUrl = await page.evaluate(() => window.location.href);
  if (calendarUrl.endsWith('/new')) {
    // TODO: detect update errors somehow
    throw new Error('Calendar entry submission failed');
  }
  return calendarUrl;
}


async function main(sessionNumber) {
  // First, retrieve known information about the project and the session
  const PROJECT_OWNER = await getEnvKey('PROJECT_OWNER');
  const PROJECT_NUMBER = await getEnvKey('PROJECT_NUMBER');
  const CALENDAR_SERVER = await getEnvKey('CALENDAR_SERVER', 'beta.w3.org');
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

  const sessionErrors = (await validateSession(sessionNumber, project))
    .filter(error => error.severity === 'error');
  if (sessionErrors.length > 0) {
    throw new Error(`Session ${sessionNumber} contains errors that need fixing`);
  }
  console.log(`Retrieve project ${PROJECT_OWNER}/${PROJECT_NUMBER}... done`);
  
  const calendarUrl = session.description.materials.calendar ?? undefined;
  const pageUrl = calendarUrl ?
    `${calendarUrl.replace(/www\.w3\.org/, CALENDAR_SERVER)}/edit/` :
    `https://${CALENDAR_SERVER}/events/meetings/new/`;

  console.log();
  console.log('Launch Puppeteer and authenticate...');
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(pageUrl);
  await authenticate(page, pageUrl);
  console.log('Launch Puppeteer and authenticate... done');

  if (calendarUrl) {
    console.log();
    console.log('Security check: make sure calendar entry is the right one...');
    await assessCalendarEntry();
    console.log('Security check: make sure calendar entry is the right one... done');
  }

  console.log();
  console.log('Fill calendar entry...');
  const newCalendarUrl = await fillCalendarEntry(page, session, project);
  console.log(`- calendar entry created/updated: ${url}`);
  console.log('Fill calendar entry... done');

  // Update session's materials with calendar URL if needed
  if (!calendarUrl) {
    // TODO: Update session's materials with calendar URL if needed
    if (!session.description.materials) {
      session.description.materials = {};
    }
    session.description.materials.calendar = newCalendarUrl;
  }

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