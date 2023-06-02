/**
 * The list of sections that may be found in a session body and, for each of
 * them, a `validate` function to validate the format of the section and a
 * `parse` function to return interpreted values.
 *
 * TODO: consider populating the list of section handlers below from the issue
 * template directly (`.github/ISSUE_TEMPLATE/breakout.yml`) to avoid
 * duplication. Typically, the file could be used to retrieve the values for
 * the section title, the `id`, the `optional` flag (and available `options` but
 * we would still need to define the mapping to parsed values).
 */
const sectionHandlers = {
  'Session description': {
    id: 'description',
    parse: value => value,
    validate: value => {
      // TODO: check markdown remains simple enough
      return true;
    }
  },

  'Session goal(s)': {
    id: 'goal',
    parse: value => value,
    validate: value => !value.match(/\n/)
  },

  'Additional session chairs': {
    optional: true,
    id: 'chairs',
    parse: value => value.split(/[\s,]/)
      .map(nick => nick.trim())
      .filter(nick => !!nick)
      .map(nick => nick.substring(1)),
    validate: value => {
      const chairs = value
        .split(/[\s,]/)
        .map(nick => nick.trim())
        .filter(nick => !!nick);
      return chairs.every(nick => nick.startsWith('@') && !nick.match(/\s/));
    }
  },

  'IRC channel': {
    optional: true,
    id: 'shortname',
    parse: value => value,
    validate: value => value.match(/[A-Za-z0-9\-_]/)
  },

  'Attendance': {
    id: 'attendance',
    options: {
      'Anyone may attend (Default)': 'public',
      'Restricted to TPAC registrants': 'restricted'
    },
    parse: value => sectionHandlers['Attendance'].options[value],
    validate: value => Object.keys(sectionHandlers['Attendance'].options).includes(value)
  },

  'Session duration': {
    id: 'duration',
    options: {
      '60 minutes (Default)': 60,
      '30 minutes': 30
    },
    parse: value => sectionHandlers['Session duration'].options[value],
    validate: value => Object.keys(sectionHandlers['Session duration'].options).includes(value)
  },

  'Scheduling conflicts': {
    optional: true,
    id: 'conflicts',
    parse: value => value.split(/[\s,]/)
      .map(issue => issue.trim())
      .filter(issue => !!issue)
      .map(issue => parseInt(issue.substring(1), 10)),
    validate: value => {
      const conflictingSessions = value
        .split(/[\s,]/)
        .map(issue => issue.trim())
        .filter(issue => !!issue);
      return conflictingSessions.every(issue => issue.match(/^#\d+$/));
    }
  },

  'Room capacity': {
    id: 'capacity',
    options: {
      'Don\'t know (Default)': 0,
      'Small (fewer than 20 people)': 15,
      'Large (20-45 people)': 30,
      'Really quite large (more than 45 people)': 50
    },
    parse: value => sectionHandlers['Room capacity'].options[value],
    validate: value => Object.keys(sectionHandlers['Room capacity'].options).includes(value)
  },

  'Comments': {
    optional: true,
    id: 'comments',
    parse: value => value,
    validate: value => true
  },

  'Meeting materials': {
    id: 'materials',
    parse: value => {
      const materials = {};
      value.split('\n')
        .map(line => line.trim())
        .filter(line => !!line)
        .map(line => line.match(/^-\s+(Agenda|Slides|Minutes|Calendar):\s*(.*)$/))
        .forEach(match => materials[match[1]] = match[2]);
      return materials;
    },
    validate: value => {
      const matches = value.split('\n')
        .map(line => line.trim())
        .filter(line => !!line)
        .map(line => line.match(/^-\s+(Agenda|Slides|Minutes|Calendar):\s*(.*)$/));
      return matches.every(match => {
        if (!match) {
          return false;
        }
        if (!['@@', 'TDB', 'TODO'].includes(match[2])) {
          try {
            new URL(match[2]);
            return true;
          }
          catch (err) {
            return false;
          }
        }
        return true;
      });
    }
  }
};


/**
 * Helper function to split a session issue body (in markdown) into sections
 */
function splitIntoSections(body) {
  return body.split(/^### /m)
    .filter(section => !!section)
    .map(section => section.split(/\r?\n/))
    .map(section => {
      let value = section.slice(1).join('\n\n').trim();
      if (value.replace(/^_(.*)_$/, '$1') === 'No response') {
        value = null;
      }
      return {
        title: section[0].replace(/ \(Optional\)$/, ''),
        value
      };
    });
}


/**
 * Validate the session issue body and return a list of errors (or an empty
 * array if all is fine)
 */
export function validateSessionBody(body) {
  return splitIntoSections(body)
    .map(section => {
      const sectionHandler = sectionHandlers[section.title];
      if (!sectionHandler) {
        return `Unexpected section "${section.title}"`;
      }
      if (!section.value && !sectionHandler.optional) {
        return `Unexpected empty section "${section.title}"`;
      }
      if (section.value && !sectionHandler.validate(section.value)) {
        return `Invalid content in section "${section.title}"`;
      }
      return null;
    })
    .filter(error => !!error);
}


/**
 * Parse the session issue body and return a structured object with values that
 * describes the session.
 */
export function parseSessionBody(body) {
  const session = {};
  splitIntoSections(body)
    .map(section => {
      const sectionHandler = sectionHandlers[section.title];
      return {
        id: sectionHandler.id,
        value: section.value ? sectionHandler.parse(section.value) : null
      };
    })
    .forEach(input => session[input.id] = input.value);
  return session;
}