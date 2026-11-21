import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RobotError, loadRobots, validateRobot } from './robots.mjs';
import { renderRobotPage, renderStoreHome } from './render.mjs';

const site = { origin: 'https://tailrobotics.com', version: 'v0.9.0', assets: '/assets/abc', buildId: 'abc' };

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
  includes: {
    print: 'Printable chassis.',
    manual: 'Assembly manual.',
    parts: 'Parts list.',
    software: 'Line-following program.',
  },
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
    ['no statement of what is included', { includes: undefined }, /includes must state/],
    ['an include left blank', { includes: { print: 'x', manual: '', parts: 'x', software: 'x' } }, /includes\.manual is required/],
    ['a blank price', { price: ' ' }, /price must be text/],
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
    const html = renderRobotPage({ site, robot: listing() }) + renderStoreHome({ site, robots: [listing()] });
    expect(html).not.toMatch(/github\.com\/cs253086/);
  });

  it('lists what is in the box, with the build steps counted', () => {
    const html = renderRobotPage({ site, robot: listing() });
    expect(html).toContain('<span>3D-printing files</span><b>Printable chassis.</b>');
    expect(html).toContain('<span>Build steps</span><b>1 step, safety notes first</b>');
    expect(html).toContain('href="#box">Get this robot</a>');
  });

  it('shows a price only when the listing has one', () => {
    expect(renderRobotPage({ site, robot: listing() })).not.toContain('Price:');
    expect(renderRobotPage({ site, robot: listing({ price: 'About $175' }) })).toContain('Price: About $175');
  });
});

describe('store home', () => {
  const robots = [
    listing(),
    listing({ slug: 'arm', name: 'Desk arm', category: 'Arms', featured: true }),
  ];
  const html = renderStoreHome({ site, robots });

  it('opens on the featured robot, as the page heading', () => {
    expect(html).toMatch(/<h1 id="hero-title">Desk arm<\/h1>/);
    expect(html).toContain('href="/robots/arm/">Get this robot</a>');
  });

  it('falls back to the first listed robot when none is featured', () => {
    expect(renderStoreHome({ site, robots: [listing()] })).toMatch(/<h1 id="hero-title">Line follower<\/h1>/);
  });

  it('shows one row per category, in the store order, with a robot only in its own', () => {
    const headings = [...html.matchAll(/<h2 id="row-[a-z]+">([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual(['Mobile', 'Arms', 'Sensors', 'Drones', 'Education']);
    const arms = html.slice(html.indexOf('id="row-arms"'), html.indexOf('id="row-sensors"'));
    expect(arms).toContain('Desk arm');
    expect(arms).not.toContain('Line follower');
  });

  it('marks a category with no robot as coming soon instead of leaving it blank', () => {
    expect(html).toContain('No Drones robots are listed yet.');
  });

  it('is still a complete page with no robot listed', () => {
    const empty = renderStoreHome({ site, robots: [] });
    expect(empty).toContain('<h1 id="hero-title">Robots you can build yourself.</h1>');
    expect(empty.match(/robot-soon/g)).toHaveLength(5);
  });

  it('promises the five things every listing carries', () => {
    for (const label of ['3D-printing files', 'Manual', 'Parts list', 'Software', 'Build steps']) {
      expect(html).toContain(`<strong>${label}</strong>`);
    }
  });

  it('keeps the CSP: no inline style, no script of its own', () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
  });
});
