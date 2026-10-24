// Robot listings: one reviewed JSON file per robot, under content/robots/.
//
// A listing is checked here, at build time, before any page is written. A
// draft is valid but never published; a listed robot must carry the review
// date that says its safety block was checked. Text is plain: there is no
// markup syntax in a listing, so nothing in it can become a link to the
// private repository or into the page's structure.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CATEGORIES = ['Mobile', 'Arms', 'Sensors', 'Drones', 'Education'];
export const SAFETY_LEVELS = ['low', 'caution', 'hazard'];
export const ICON_COLORS = ['blue', 'brown', 'green', 'violet'];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const IMAGE = /^[a-z0-9][a-z0-9-]*\.(svg|png|jpg|webp)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['draft', 'listed'];

export class RobotError extends Error {}

const text = (value) => typeof value === 'string' && value.trim() !== '';

// Returns the listing, or throws naming the file and the first rule it broke.
export function validateRobot(robot, file) {
  const fail = (rule) => {
    throw new RobotError(`${file}: ${rule}`);
  };
  if (!robot || typeof robot !== 'object') fail('not a JSON object');
  for (const field of ['slug', 'name', 'developer', 'summary', 'board', 'tailosVersion']) {
    if (!text(robot[field])) fail(`${field} is required`);
  }
  if (!SLUG.test(robot.slug)) fail(`slug "${robot.slug}" must be lowercase letters, digits and hyphens`);
  if (!CATEGORIES.includes(robot.category)) fail(`category must be one of ${CATEGORIES.join(', ')}`);
  if (!STATUSES.includes(robot.status)) fail('status must be "draft" or "listed"');

  if (!Array.isArray(robot.safety)) fail('safety must be a list (it may be empty only for a draft)');
  for (const item of robot.safety) {
    if (!SAFETY_LEVELS.includes(item?.level)) fail(`safety level must be one of ${SAFETY_LEVELS.join(', ')}`);
    if (!text(item.text)) fail('each safety item needs text');
  }

  if (!Array.isArray(robot.needs) || robot.needs.length === 0) fail('needs must list at least one part');
  for (const need of robot.needs) {
    if (!text(need?.item) || !text(need?.spec)) fail('each need needs an item and a spec');
  }

  if (!Array.isArray(robot.steps) || robot.steps.length === 0) fail('steps must list at least one step');
  for (const step of robot.steps) {
    if (!text(step?.title) || !text(step?.body)) fail('each step needs a title and a body');
  }

  if (robot.buildMinutes !== undefined && !(Number.isInteger(robot.buildMinutes) && robot.buildMinutes > 0)) {
    fail('buildMinutes must be a positive whole number');
  }
  if (robot.color !== undefined && !ICON_COLORS.includes(robot.color)) {
    fail(`color must be one of ${ICON_COLORS.join(', ')}`);
  }
  if (robot.featured !== undefined && typeof robot.featured !== 'boolean') fail('featured must be true or false');
  if (robot.image !== undefined && !(typeof robot.image === 'string' && IMAGE.test(robot.image))) {
    fail('image must be a file name such as line-follower.svg, kept in content/robots/images');
  }
  if (robot.photos !== undefined) {
    if (!Array.isArray(robot.photos) || robot.photos.some((p) => typeof p !== 'string' || !p.startsWith('/'))) {
      fail('photos must be paths starting with "/"');
    }
  }

  if (robot.status === 'listed') {
    if (!DATE.test(robot.reviewed ?? '')) fail('a listed robot needs "reviewed" as a YYYY-MM-DD date');
    if (robot.safety.length === 0) fail('a listed robot must state its safety, even if it is only "low"');
  }
  return robot;
}

// Reads every listing in the folder. Every file is checked, drafts included,
// so a broken draft is caught before it is listed. Returns listed robots only.
export function loadRobots(dir) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  const robots = [];
  for (const file of files) {
    const robot = validateRobot(JSON.parse(readFileSync(join(dir, file), 'utf8')), file);
    // The file name is the slug, so two listings cannot share a URL.
    if (file !== `${robot.slug}.json`) throw new RobotError(`${file}: file name must match slug "${robot.slug}"`);
    if (robot.status === 'listed') robots.push(robot);
  }
  return robots;
}
