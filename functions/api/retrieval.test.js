import { describe, expect, it } from 'vitest';
import corpus from '../../generated/chunks.json';
import { passagesFor } from './ask.js';

// Questions readers have asked, each with a phrase only a passage that answers
// it contains. Most are phrasings a cowork test of the live site asked across
// four rounds; several were refused or degraded when the passage that answers
// them ranked just outside what the model is given, which no amount of page
// rewording fixes for the next phrasing along. This runs against the published
// corpus, so a document edit that drops a fact, or pushes its passage out of
// reach, fails here instead of on the live site.
const QUESTIONS = [
  ['How many components are inside tail_qemu.rfs?', '16 components'],
  ['Where is the tsh binary located?', 'the shell itself is /rfs/tsh'],
  ['What does ls /rfs list?', 'ls /rfs lists them'],
  ['Why does /rfs not show up in ls /?', 'separate file system mounted beside it'],
  ['How do I exit QEMU?', 'lowercase x'],
  ['Does uppercase X quit QEMU?', 'Uppercase X and C do nothing'],
  ['What address does QEMU load the kernel at?', '0x80000'],
  ['How many programs are in /usr/bin on the QEMU image?', '27 programs'],
  ['How many programs are in /usr/bin on the Raspberry Pi image?', '26 programs'],
  ['How many programs are on the Raspberry Pi 3 image?', '26 programs'],
  ['How many programs does the BSP image have in /usr/bin?', '26 programs'],
  ['What is list-root-long?', 'list-root-long, a copy of ls'],
  ['What license is TAIL OS released under?', 'TAIL OS is proprietary software'],
  ['What licence is TAIL OS released under?', 'TAIL OS is proprietary software'],
  ['Can I use TAIL OS commercially without a license?', 'Commercial use needs a written license'],
  ['Do I need a license for commercial use of TAIL OS?', 'Commercial use needs a written license'],
  ['Is commercial use of TAIL OS allowed without a license?', 'Commercial use needs a written license'],
  ['What does the Bluetooth firmware license allow?', 'binary form only'],
  ['What is the serial baud rate?', '115200'],
  ['Which GPIO pins does the serial console use?', 'GPIO 14'],
  ['Which Python version does TAIL OS ship?', 'Python 3.14'],
  ['Does the Raspberry Pi image include Python?', 'Python is not on this image'],
  ['Where does the Python periodic module come from?', 'python314.zip'],
  ['How big is the SDK bundle?', '289 MiB'],
  ['How large is the boot partition on the Pi 3 image?', '64 MiB'],
  ['Why is the SD card image 256 MiB?', 'power-of-two'],
  ['Which file does make-disk.sh write?', 'writes tailos_sd.img'],
  ['Why is gpu_mem set to 64?', 'start_cd.elf'],
  ['What should I do if make-disk.sh rejects my SDK?', 'Install the SDK published with this BSP'],
  ['How do I flash the SD card?', 'dd if=tailos_sd.img'],
  ['How do I add my own program to the Raspberry Pi image?', 'app/<name>/src/main.rs'],
  ['What messages does the Pi image print under QEMU?', 'netdev_usb0: InvalidInput'],
  ['How long does TAIL OS take to boot in QEMU?', 'Boot takes a few seconds'],
  ['Why is the first python run slow?', 'The first run after boot is the slow one'],
  ['How much disk space does the quick start need?', '580 to 970 MiB'],
  ['How do I force a fresh download of the images?', 'rm -rf ~/.cache/tailos'],
];

const flat = (text) => text.replace(/`/g, '').replace(/\s+/g, ' ');
const answering = (phrase) => corpus.chunks.filter((chunk) => flat(chunk.text).includes(phrase));

describe('retrieval', () => {
  it.each(QUESTIONS)('the docs still state the answer to "%s"', (_question, phrase) => {
    expect(answering(phrase).length, `no passage says "${phrase}"`).toBeGreaterThan(0);
  });

  it.each(QUESTIONS)('hands the model a passage that answers "%s"', (question, phrase) => {
    const given = new Set(passagesFor(question).passages.map((chunk) => chunk.id));
    const answers = answering(phrase).map((chunk) => chunk.id);
    expect(answers.some((id) => given.has(id)), `given: ${[...given].join(', ')}`).toBe(true);
  });
});
