import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));


/**
 * The list of sections that may be found in a session body and, for each of
 * them, a `validate` function to validate the format of the section and a
 * `parse` function to return interpreted values.
 *
 * The list needs to be populated once and for all through a call to the async
 * `initSectionHandlers` function, which reads section info from the
 * `session.yml` file.
 */
let sectionHandlers = null;


/**
 * Populate the list of section handlers from the info in `session.yml`.
 *
 * The function needs to be called once before `parseSessionBody` or
 * `validateSessionBody` may be called.
 */
export async function initSectionHandlers() {
  const yamlTemplate = await readFile(
    path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE', 'session.yml'),
    'utf8');
  const template = YAML.parse(yamlTemplate);
  sectionHandlers = template.body
    .filter(section => !!section.id)
    .map(section => {
      const handler = {
        id: section.id,
        title: section.attributes.label.replace(/ \(Optional\)$/, ''),
        required: !!section.validations?.required,
        validate: value => true,
        parse: value => value
      };
      if (section.type === 'dropdown') {
        handler.options = section.attributes.options;
        handler.validate = value => handler.options.includes(value);
      }
      else if (section.type === 'input') {
        handler.validate = value => !value.match(/\n/)
      }
      return handler;
    })
    .map(handler => {
      // Add custom validation constraints and parse logic
      // TODO: could some of this custom logic be expressed in the YAML file
      // directly to avoid having to look at two places when making changes?
      // Or would GitHub reject the YAML file if it contains additional
      // properties?
      switch (handler.id) {

      case 'description':
        // TODO: validate that markdown remains simple enough
        break;

      case 'chairs':
        // List of GitHub identities
        handler.parse = value => value.split(/[\s,]/)
          .map(nick => nick.trim())
          .filter(nick => !!nick)
          .map(nick => nick.substring(1));
        handler.validate = value => {
          const chairs = value
            .split(/[\s,]/)
            .map(nick => nick.trim())
            .filter(nick => !!nick);
          return chairs.every(nick => nick.startsWith('@') &&
            nick.match(/^[A-Za-z0-9][A-Za-z0-9\-]+$/));
        }
        break;

      case 'shortname':
        handler.validate = value => value.match(/[A-Za-z0-9\-_]/);
        break;

      case 'attendance':
        handler.parse = value => value === 'Restricted to TPAC registrants' ?
          'restricted' : 'public';
        break;

      case 'duration':
        handler.parse = value => value === '30 minutes' ? 30 : 60;
        break;

      case 'conflicts':
        // List of GitHub issues
        handler.parse = value => value.split(/[\s,]/)
          .map(issue => issue.trim())
          .filter(issue => !!issue)
          .map(issue => parseInt(issue.substring(1), 10));
        handler.validate = value => {
          const conflictingSessions = value
            .split(/[\s,]/)
            .map(issue => issue.trim())
            .filter(issue => !!issue);
          return conflictingSessions.every(issue => issue.match(/^#\d+$/));
        };
        break;

      case 'capacity':
        handler.parse = value => {
          switch (value) {
          case 'Don\'t know (Default)': return 0;
          case 'Small (fewer than 20 people)': return 15;
          case 'Large (20-45 people)': return 30;
          case 'Really quite large (more than 45 people)': return 50;
          };
        };
        break;

      case 'materials':
        handler.parse = value => {
          const materials = {};
          value.split('\n')
            .map(line => line.trim())
            .filter(line => !!line)
            .map(line => line.match(/^-\s+(Agenda|Slides|Minutes|Calendar):\s*(.*)$/))
            .forEach(match => materials[match[1]] = match[2]);
          return materials;
        };
        handler.validate = value => {
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
        break;
      }

      return handler;
    });
}


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
  if (!sectionHandlers) {
    throw new Error('Need to call `initSectionHandlers` first!');
  }
  return splitIntoSections(body)
    .map(section => {
      const sectionHandler = sectionHandlers.find(handler =>
        handler.title === section.title);
      if (!sectionHandler) {
        return `Unexpected section "${section.title}"`;
      }
      if (!section.value && sectionHandler.required) {
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
  if (!sectionHandlers) {
    throw new Error('Need to call `initSectionHandlers` first!');
  }
  const session = {};
  splitIntoSections(body)
    .map(section => {
      const sectionHandler = sectionHandlers.find(handler =>
        handler.title === section.title);
      return {
        id: sectionHandler.id,
        value: section.value ? sectionHandler.parse(section.value) : null
      };
    })
    .forEach(input => session[input.id] = input.value);
  return session;
}