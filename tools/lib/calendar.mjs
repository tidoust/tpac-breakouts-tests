import { validateSession } from './validate.mjs';
import { updateSessionDescription } from './session.mjs';
import { todoStrings } from './todoStrings.mjs';

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
 * Login to W3C server.
 *
 * The function throws if login fails.
 */
export async function authenticate(page, login, password, redirectUrl) {
  const url = await page.evaluate(() => window.location.href);
  if (!url.endsWith('/login')) {
    return;
  }

  const usernameInput = await page.waitForSelector('input#username');
  await usernameInput.type(login);

  const passwordInput = await page.waitForSelector('input#password');
  await passwordInput.type(password);

  const submitButton = await page.waitForSelector('button[type=submit]');
  await submitButton.click();

  await page.waitForNavigation();
  const newUrl = await page.evaluate(() => window.location.href);
  if (newUrl !== redirectUrl) {
    throw new Error('Could not login. Invalid credentials?');
  }
}


/**
 * Make sure that the calendar entry loaded in the given browser's page links
 * back to the given session.
 * 
 * The function throws if that's not the case.
 */
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


/**
 * Fill/Update calendar entry loaded in the given browser's page with the
 * session's info.
 *
 * The function returns the URL of the calendar entry, once created/updated.
 */
export async function fillCalendarEntry(page, session, project) {
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
  if (calendarUrl.endsWith('/new') || calendarUrl.endsWith('/edit/')) {
    throw new Error('Calendar entry submission failed');
  }
  return calendarUrl;
}


/**
 * Create/Update calendar entry that matches given session
 */
export async function convertSessionToCalendarEntry(
    { browser, session, project, calendarServer, login, password }) {
  // First, retrieve known information about the project and the session
  const sessionErrors = (await validateSession(session.number, project))
    .filter(error => error.severity === 'error');
  if (sessionErrors.length > 0) {
    throw new Error(`Session ${session.number} contains errors that need fixing`);
  }
  if (!session.slot) {
    // TODO: if calendar URL is set, delete calendar entry
    return;
  }

  const calendarUrl = session.description.materials.calendar ?? undefined;
  const pageUrl = calendarUrl ? 
    `${calendarUrl.replace(/www\.w3\.org/, calendarServer)}edit/` :
    `https://${calendarServer}/events/meetings/new/`;

  console.log('- load calendar page');
  const page = await browser.newPage();

  try {
    await page.goto(pageUrl);
    await authenticate(page, login, password, pageUrl);

    if (calendarUrl) {
      console.log('- security check: make sure calendar entry is the right one');
      await assessCalendarEntry(page, session);
    }

    console.log('- fill calendar entry');
    const newCalendarUrl = await fillCalendarEntry(page, session, project);
    console.log(`- calendar entry created/updated: ${newCalendarUrl}`);

    // Update session's materials with calendar URL if needed
    if (!calendarUrl) {
      console.log(`- add calendar URL to session description`);
      if (!session.description.materials) {
        session.description.materials = {};
      }
      session.description.materials.calendar = newCalendarUrl;
      await updateSessionDescription(session);
    }
  }
  finally {
    await page.close();
  }
}
