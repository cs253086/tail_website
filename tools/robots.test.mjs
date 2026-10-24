import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RobotError, loadRobots, validateRobot } from './robots.mjs';
import { renderRobotPage, renderRobotsIndex } from './render.mjs';

const site = { origin: 'https://tail-os.com', version: 'v0.9.0', assets: '/assets/abc', buildId: 'abc' };

const listing = (overrides = {}) => ({
  slug: 'line-follower',
  name: 'Line follower',
  developer: 'Example developer',
  summary: 'Follows a black line.',
  category: 'Mobile',
  board: 'Raspberry Pi 3B',
  tailosVersion: '0.9',
  safety: [{ level: 'hazard', text: 'The motors start at power-on.' }],
  needs: [{ item: 'Raspberry Pi', spec: '3B' }],
  steps: [{ title: 'Mount', body: 'Fix the sensors.' }],
  status: 'listed',
  reviewed: '2026-10-17',
  ...overrides,
});

describe('validateRobot', () => {
  it('accepts a complete listing', () => {
    expect(validateRobot(listing(), 'line-follower.json').slug).toBe('line-follower');
  });

  it.each([
    ['a missing name', { name: '' }, /name is required/],
    ['a slug with capitals', { slug: 'Line' }, /lowercase letters/],
    ['an unknown category', { category: 'Robots' }, /category must be one of/],
    ['an unknown status', { status: 'published' }, /status must be/],
    ['an unknown safety level', { safety: [{ level: 'severe', text: 'x' }] }, /safety level/],
    ['no parts list', { needs: [] }, /at least one part/],
    ['no steps', { steps: [] }, /at least one step/],
    ['a step without a body', { steps: [{ title: 'Mount', body: '' }] }, /title and a body/],
    ['an unknown colour', { color: 'pink' }, /color must be one of/],
    ['a picture that is not a file name', { image: '../secret.svg' }, /image must be a file name/],
    ['a picture of an unknown type', { image: 'robot.gif' }, /image must be a file name/],
    ['a photo that is not a path', { photos: ['photo.jpg'] }, /paths starting with/],
    ['a listed robot with no review date', { reviewed: undefined }, /reviewed/],
    ['a listed robot with no safety stated', { safety: [] }, /must state its safety/],
  ])('refuses %s', (_name, overrides, message) => {
    expect(() => validateRobot(listing(overrides), 'x.json')).toThrow(message);
  });

  it('lets a draft omit its review date, since nothing is published from it', () => {
    expect(() => validateRobot(listing({ status: 'draft', reviewed: undefined }), 'x.json')).not.toThrow();
  });

  it('accepts a picture, a colour and the featured flag', () => {
    expect(() => validateRobot(listing({ image: 'line-follower.svg', color: 'blue', featured: true }), 'x.json')).not.toThrow();
  });
});

describe('loadRobots', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'robots-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, data) => writeFileSync(join(dir, name), JSON.stringify(data));

  it('returns listed robots and never a draft', () => {
    write('line-follower.json', listing());
    write('arm.json', listing({ slug: 'arm', name: 'Arm', status: 'draft' }));
    expect(loadRobots(dir).map((robot) => robot.slug)).toEqual(['line-follower']);
  });

  it('checks drafts too, so a broken draft fails the build before it is listed', () => {
    write('arm.json', listing({ slug: 'arm', status: 'draft', steps: [] }));
    expect(() => loadRobots(dir)).toThrow(RobotError);
  });

  it('refuses a file whose name does not match its slug', () => {
    write('other.json', listing());
    expect(() => loadRobots(dir)).toThrow(/file name must match slug/);
  });
});

describe('robot pages', () => {
  it('shows a hazard before the build steps', () => {
    const html = renderRobotPage({ site, robot: listing() });
    expect(html.indexOf('data-level="hazard"')).toBeLessThan(html.indexOf('Build steps'));
  });

  it('escapes listing text, so it cannot become markup', () => {
    const html = renderRobotPage({ site, robot: listing({ summary: '<img src=x onerror=alert(1)>' }) });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('states the review date and the board it was tested on', () => {
    const html = renderRobotPage({ site, robot: listing() });
    expect(html).toContain('Safety notes reviewed on 2026-10-17.');
    expect(html).toContain('Tested on: Raspberry Pi 3B');
  });

  it('shows the listing picture when there is one, and the initials when there is not', () => {
    expect(renderRobotPage({ site, robot: listing({ image: 'line-follower.svg' }) }))
      .toContain('src="/robots/images/line-follower.svg"');
    expect(renderRobotPage({ site, robot: listing() })).toContain('class="robot-icon');
  });

  it('never links to the private repository', () => {
    const html = renderRobotPage({ site, robot: listing() }) + renderRobotsIndex({ site, robots: [listing()] });
    expect(html).not.toMatch(/github\.com\/cs253086/);
  });

  it('says so on an empty index instead of showing a blank page', () => {
    expect(renderRobotsIndex({ site, robots: [] })).toContain('No robots are listed yet.');
  });
});
