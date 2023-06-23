/**
 * This tool initializes IRC channels that will be used for breakout sessions.
 *
 * To run the tool:
 *
 *  node tools/setup-irc.mjs [sessionNumber or slot]
 *
 * where [sessionNumber] is the number of the session issue for which the IRC
 * channel should be initialized (e.g. 15), the slot for which IRC channels
 * should be initialized, or "all" to initialize all channels.
 *
 * The tools should essentially be run once per slot, shortly before the
 * sessions start.
 */

import { getEnvKey } from './lib/envkeys.mjs';
import { fetchProject } from './lib/project.mjs'
import { validateSession } from './lib/validate.mjs';
import { todoStrings } from './lib/todostrings.mjs';
import irc from 'irc';

const botName = 'tpac-breakout-bot';

/**
 * Helper function to generate a shortname from the session's title
 */
function getShortname(session) {
  return session?.description?.shortname ??
    session.title
      .toLowerCase()
      .replace(/\([^\)]\)/g, '')
      .replace(/[^a-z0-0\-\s]/g, '')
      .replace(/\s+/g, '-');
}

async function main({ number, slot } = {}) {
  const PROJECT_OWNER = await getEnvKey('PROJECT_OWNER');
  const PROJECT_NUMBER = await getEnvKey('PROJECT_NUMBER');
  console.log();
  console.log(`Retrieve project ${PROJECT_OWNER}/${PROJECT_NUMBER}...`);
  const project = await fetchProject(PROJECT_OWNER, PROJECT_NUMBER);

  let sessions = project.sessions.filter(s => s.slot &&
    ((!number && !slot) || s.number === number || s.slot === slot));
  sessions.sort((s1, s2) => s1.number - s2.number);
  if (number) {
    if (sessions.length === 0) {
      throw new Error(`Session ${number} not found in project ${PROJECT_OWNER}/${PROJECT_NUMBER}`);
    }
    else if (!sessions[0].slot) {
      throw new Error(`Session ${number} not assigned to a slot in project ${PROJECT_OWNER}/${PROJECT_NUMBER}`);
    }
  }
  else if (slot) {
    console.log(`- found ${sessions.length} sessions assigned to slot ${slot}: ${sessions.map(s => s.number).join(', ')}`);
  }
  else {
    console.log(`- found ${sessions.length} sessions assigned to slots: ${sessions.map(s => s.number).join(', ')}`);
  }
  sessions = await Promise.all(sessions.map(async session => {
    const sessionErrors = (await validateSession(session.number, project))
      .filter(error => error.severity === 'error');
    if (sessionErrors.length > 0) {
      return null;
    }
    return session;
  }));
  sessions = sessions.filter(s => !!s);
  if (number) {
    if (sessions.length === 0) {
      throw new Error(`Session ${number} contains errors that need fixing`);
    }
  }
  else {
    console.log(`- found ${sessions.length} valid sessions among them: ${sessions.map(s => s.number).join(', ')}`);
  }
  console.log(`Retrieve project ${PROJECT_OWNER}/${PROJECT_NUMBER} and session(s)... done`);

  function sendChannelBotCommands(channel, nick) {
    const session = sessions.find(s => channel = '#' + getShortname(s));
    if (!session) {
      return;
    }
    const room = project.rooms.find(r => r.name === session.room);
    const roomLabel = room ? `- ${room.label} ` : '';
    if (nick === botName) {
      bot.send('TOPIC', channel, `TPAC breakout: ${session.title} ${roomLabel}- ${session.slot}`);
      bot.send('INVITE', 'Zakim', channel);
      bot.send('INVITE', 'RRSAgent', channel);
    }
    else if (nick === 'RRSAgent') {
      bot.say(channel, 'RRSAgent, make logs public');
      bot.say(channel, `Meeting: ${session.title}`);
      bot.say(channel, `Chair: ${session.chairs.map(c => c.name).join(', ')}`);
      if (session.description.materials.agenda &&
          !todoStrings.includes(session.description.materials.agenda)) {
        bot.say(channel, `Agenda: ${session.description.materials.agenda}`);
      }
      bot.part(channel);
    }
    else if (nick === 'Zakim') {
      // No specific command to send when Zakim joins
    }
  }

  console.log();
  console.log('Connect to W3C IRC server...');
  const bot = new irc.Client('irc.w3.org', botName, {
    channels: []
  });

  bot.addListener('registered', msg => {
    console.log(`- Received message: ${msg.command}`);
    console.log('Connect to W3C IRC server... done');
    for (const session of sessions) {
      bot.join('#' + getShortname(session));
    }
  });

  bot.addListener('raw', msg => {
    //console.log(JSON.stringify(msg, null, 2));
  });


  bot.addListener('error', err => {
    if (err.command === 'err_useronchannel') {
      // We invited bots but they're already there, that's good!
      const nick = err.args[1];
      const channel = err.args[2];
      console.log(`- ${nick} was already in ${channel}`);
      sendChannelBotCommands(channel, nick);
      return;
    }
    throw err;
  });

  bot.addListener('join', (channel, nick, message) => {
    console.log(`- ${nick} joined ${channel}`);
    sendChannelBotCommands(channel, nick);
  });

  bot.addListener('part', (channel, nick) => {
    if (nick !== botName) {
      return;
    }
    const session = sessions.find(s => channel = '#' + getShortname(s));
    if (!session) {
      return;
    }
    session.done = true;
    if (sessions.every(s => s.done)) {
      bot.disconnect(_ => promiseResolve());
    }
  });

  let promiseResolve;
  return new Promise(resolve => promiseResolve = resolve);
}


// Read session number or slot from command-line
if (!process.argv[2] || !process.argv[2].match(/^(\d+|all|\d{1:2}:\d{2})$/)) {
  console.log('Command needs to receive a session number (e.g., 15), a slot (e.g. 9:30) or "all" as first parameter');
  process.exit(1);
}

const sessionNumber = process.argv[2].match(/^\d+$/) ?
  parseInt(process.argv[2], 10) : undefined;
const slot = process.argv[2].match(/^\d{1:2}:\d{2}$/) ?
  process.argv[2] : undefined;

main({ number: sessionNumber, slot })
  .then(_ => process.exit(0))
  .catch(err => {
    console.log(`Something went wrong: ${err.message}`);
    throw err;
  });