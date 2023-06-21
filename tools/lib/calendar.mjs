import { validateSession } from './validate.mjs';
import { updateSessionDescription } from './session.mjs';
import { todoStrings } from './todostrings.mjs';

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
 * Helper function to generate a shortname from the session's title
 */
function generateShortname(session) {
  return session.title
    .toLowerCase()
    .replace(/\([^\)]\)/g, '')
    .replace(/[^a-z0-0\-\s]/g, '')
    .replace(/\s+/g, '-');
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
  if (!desc.includes(`- [GitHub issue](${issueUrl}`)) {
    throw new Error('Calendar entry does not link back to GitHub issue');
  }
}


/**
 * Fill/Update calendar entry loaded in the given browser's page with the
 * session's info.
 *
 * The function returns the URL of the calendar entry, once created/updated.
 */
async function fillCalendarEntry({ page, session, project, status, zoom }) {
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
    // Note this should use platform-specific commands in theory
    // ... but that would not work on Mac in any case, see:
    // https://github.com/puppeteer/puppeteer/issues/1313
    await el.click({ clickCount: 1 });
    await page.keyboard.down('ControlLeft');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('ControlLeft');
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

  // Note statuses are different when calendar entry has already been flagged as
  // "tentative" or "confirmed" ("draft" no longer exists in particular).
  status = status ?? 'draft';
  await page.$eval(`input[name="event[status]"][value=${status}]`, el => el.checked = true);
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

  // Add chairs as individual attendees
  // Note: the select field is hidden so attendees will only appear once
  // calendar entry has been submitted.
  const chairs = session.chairs.filter(chair => chair.w3cId && chair.w3cId !== -1);
  if (chairs.length > 0) {
    await page.evaluate(`window.tpac_breakouts_chairs = ${JSON.stringify(chairs, null, 2)};`);
    await page.$eval('select#event_individuals', el => el.innerHTML =
      window.tpac_breakouts_chairs
        .map(chair => `<option value="${chair.w3cId}" selected="selected">${chair.name}</option>`)
        .join('\n')
    );
  }

  await clickOnElement('input#event_joinVisibility_' + (session.description.attendance === 'restricted' ? '1' : '0'));

  if (zoom) {
    await fillTextInput('input#event_joinLink', zoom);
    await fillTextInput('textarea#event_joiningInstructions', 'TODO: joining instructions');
  }
  else {
    // No Zoom info? Let's preserve what the calendar entry may already contain.
  }

  await fillTextInput('input#event_chat',
    `https://irc.w3.org/?channels=#${session.description.shortname ?? generateShortname(session)}`);
  const agendaUrl = todoStrings.includes(session.description.materials.agenda) ?
    undefined : session.description.materials.agenda;
  await fillTextInput('input#event_agendaUrl', agendaUrl);
  const minutesUrl = todoStrings.includes(session.description.materials.minutes) ?
    undefined : session.description.materials.minutes;
  await fillTextInput('input#event_minutesUrl', minutesUrl);

  // Big meeting is "TPAC 2023", not the actual option value
  await page.evaluate(`window.tpac_breakouts_meeting = "${project.metadata.meeting}";`);
  await page.$$eval('select#event_big_meeting option', options => options.forEach(el =>
    el.selected = el.innerText.startsWith(window.tpac_breakouts_meeting)));
  await chooseOption('select#event_category', 'breakout-sessions');

  // Click on "Create/Update but don't send notifications" button
  // and return URL of the calendar entry
  await clickOnElement(status === 'draft' ?
    'button#event_submit' :
    'button#event_no_notif');
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
    { browser, session, project, calendarServer, login, password, status, zoom }) {
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

  console.log(`- load calendar page: ${pageUrl}`);
  const page = await browser.newPage();

  try {
    await page.goto(pageUrl);
    await authenticate(page, login, password, pageUrl);

    if (calendarUrl) {
      console.log('- make sure existing calendar entry is linked to the session');
      await assessCalendarEntry(page, session);
    }

    console.log('- fill calendar entry');
    const newCalendarUrl = await fillCalendarEntry({
      page, session, project, status, zoom
    });
    console.log(`- calendar entry created/updated: ${newCalendarUrl}`);

    // Update session's materials with calendar URL if needed
    if (newCalendarUrl && !calendarUrl) {
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
