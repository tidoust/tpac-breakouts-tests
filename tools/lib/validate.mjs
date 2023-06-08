import { fetchProject, validateProject } from './project.mjs';
import { initSectionHandlers, validateSessionBody, parseSessionBody } from './session.mjs';
import { fetchSessionChairs, validateSessionChairs } from './chairs.mjs';


/**
 * Validate the entire grid.
 * 
 * The function returns a list of errors by type. Each error links to the
 * session that may need some care.
 */
export async function validateGrid(project) {
  const projectErrors = validateProject(project);
  if (projectErrors.length > 0) {
    throw new Error(`Project "${project.title}" is invalid:
${projectErrors.map(error => '- ' + error).join('\n')}`);
  }

  let errors = [];
  for (const session of project.sessions) {
    const sessionErrors = await validateSession(session.number, project);
    errors = errors.concat(sessionErrors);
  }
  return errors;
}


/**
 * Validate a session.
 *
 * The function returns a list of errors by type (i.e., by GitHub "label").
 * Errors in the list may be real errors or warnings.
 */
export async function validateSession(sessionNumber, project) {
  const projectErrors = validateProject(project);
  if (projectErrors.length > 0) {
    throw new Error(`Project "${project.title}" is invalid:
${projectErrors.map(error => '- ' + error).join('\n')}`);
  }

  // Look for session in the list of issues in the project
  const session = project.sessions.find(s => s.number === sessionNumber);
  if (!session) {
    throw new Error(`Session #${sessionNumber} is not in project "${project.title}"`);
  }

  // List of validation issues found, grouped by type (i.e. by label).
  let errors = [];

  // Validate and parse the session body, unless that was already done
  if (!session.description) {
    await initSectionHandlers();
    const formatErrors = validateSessionBody(session.body);
    if (formatErrors.length > 0) {
      errors.push({
        session: sessionNumber,
        severity: 'error',
        type: 'format',
        messages: formatErrors
      });
      // Cannot validate the rest for now if body cannot be parsed
      return errors;
    }
    session.description = parseSessionBody(session.body);
  }

  // Retrieve information about chairs, unless that was already done
  if (!session.chairs) {
    session.chairs = await fetchSessionChairs(session);
  }
  const chairsErrors = validateSessionChairs(session.chairs);
  if (chairsErrors.length > 0) {
    errors.push({
      session: sessionNumber,
      severity: 'error',
      type: 'chairs',
      messages: chairsErrors
    });
  }

  // Make sure sessions identified as conflicting actually exist
  let hasConflictErrors = false;
  if (session.description.conflicts) {
    const conflictErrors = session.description.conflicts
      .map(number => {
        if (number === sessionNumber) {
          return `Session cannot conflict with itself`;
        }
        const conflictingSession = project.sessions.find(s => s.number === number);
        if (!conflictingSession) {
          return `Conflicting session ${number} is not in the project`;
        }
        return null;
      })
      .filter(error => !!error);
    hasConflictErrors = conflictErrors.length > 0;
    if (hasConflictErrors) {
      errors.push({
        session: sessionNumber,
        severity: 'error',
        type: 'conflict',
        messages: conflictErrors
      });
    }
  }

  // Make sure there is no session scheduled at the same time in the same room
  const scheduled = session.room && session.slot;
  if (scheduled) {
    const schedulingErrors = project.sessions
      .filter(s => s !== session && s.room && s.slot)
      .filter(s => s.room === session.room && s.slot === session.slot)
      .map(s => `Session scheduled in same room (${s.room}) and same slot (${s.slot}) as session "${s.title}" (${s.number})`);
    if (schedulingErrors.length > 0) {
      errors.push({
        session: sessionNumber,
        severity: 'error',
        type: 'scheduling',
        messages: schedulingErrors
      });
    }
  }

  // Check assigned room matches requested capacity
  if (session.room && session.description.capacity) {
    const room = project.rooms[session.room];
    if (room.capacity < session.description.capacity) {
      errors.push({
        session: sessionNumber,
        severity: 'warning',
        type: 'capacity'
      });
    }
  }

  // Check assigned slot is different from conflicting sessions
  // (skipped if the list of conflicting sessions is invalid)
  if (!hasConflictErrors && session.slot && session.description.conflicts) {
    const conflictWarnings = session.description.conflicts
      .map(number => {
        const conflictingSession = project.sessions.find(s => s.number === number);
        if (conflictingSession.slot === session.slot) {
          return `Same slot "${session.slot}" as conflicting session "${conflictingSession.title}" (#${conflictingSession.number})`;
        }
        return null;
      })
      .filter(warning => !!warning);
    if (conflictWarnings.length > 0) {
      errors.push({
        session: sessionNumber,
        severity: 'warning',
        type: 'conflict',
        messages: conflictWarnings
      });
    }
  }

  // Check absence of conflict with sessions in the same track(s)
  if (session.slot) {
    const tracks = session.labels.filter(label => label.startsWith('track: '));
    let tracksWarnings = [];
    for (const track of tracks) {
      const sessionsInSameTrack = project.sessions.filter(s => s !== session && s.labels.includes(track));
      const trackWarnings = sessionsInSameTrack
        .map(other => {
          if (other.slot === session.slot) {
            return `Same slot "${session.slot}" as session in same track "${track}": "${other.title}" (#${other.number})`;
          }
          return null;
        })
        .filter(warning => !!warning);
      tracksWarnings = tracksWarnings.concat(trackWarnings);
    }
    if (tracksWarnings.length > 0) {
      errors.push({
        session: sessionNumber,
        severity: 'warning',
        type: 'track',
        messages: trackWarnings
      });
    }
  }

  // Check presence of comments
  if (session.description.comments) {
    errors.push({
      session: sessionNumber,
      severity: 'check',
      type: 'comments',
      messages: ['Session contains comments']
    });
  }

  function isMaterialMissing(name) {
    return !session.description.materials[name] ||
      ['@', '@@', '@@@', 'TBD', 'TODO'].includes(session.description.materials[name].toUpperCase());
  }

  // If breakout session takes place in less than 2 days (or past),
  // time to add a link to an agenda
  const twoDaysInMs = 48 * 60 * 60 * 1000;
  const inLessThanTwoDays = (
      (new Date(project.metadata.date)).getTime() -
      (new Date()).getTime()
    ) < twoDaysInMs;
  if (scheduled && isMaterialMissing('agenda') && inLessThanTwoDays) {
    errors.push({
      session: sessionNumber,
      severity: 'warning',
      type: 'agenda',
      messages: ['Session needs a link to an agenda']
    });
  }

  // If breakout session took place more than 2 days ago,
  // time to add a link to the minutes
  const atLeastTwoDaysOld = (
      (new Date()).getTime() -
      (new Date(project.metadata.date)).getTime()
    ) > twoDaysInMs;
  if (scheduled && isMaterialMissing('minutes') && atLeastTwoDaysOld) {
    errors.push({
      session: sessionNumber,
      severity: 'warning',
      type: 'minutes',
      messages: ['Session needs a link to the minutes']
    });
  }

  return errors;
}