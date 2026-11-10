// What changed in each version, newest first. Shown to players, so keep the words plain.
// Every release adds an entry here; a test compares the newest one with package.json.
export const PATCH_NOTES = [
  {
    version: '1.19.0',
    date: '2026-11-10',
    changes: [
      'Every item in the upgrade shop now has an Auto button. Items set to Auto are bought by themselves as soon as you have a point, without stopping the game.',
      'With several items on Auto, points are shared out evenly between them. Your Auto choices are remembered for the next run.',
      'On a keyboard, Shift and the item\'s number switch Auto on or off.',
    ],
  },
  {
    version: '1.18.0',
    date: '2026-11-09',
    changes: ['Added these patch notes to the start and end screens.'],
  },
  {
    version: '1.17.0',
    date: '2026-11-09',
    changes: [
      'Enemies spawn more often as the difficulty level rises, up to three times the normal rate.',
      'The limit on enemies at once rises with the level too.',
      'Admins can set how much more often enemies spawn per level, or turn it off.',
    ],
  },
  {
    version: '1.16.0',
    date: '2026-11-09',
    changes: ['New Aim boss button: your shots go for a boss first while it is on screen and in range. Aiming by hand still overrides it.'],
  },
  {
    version: '1.15.1',
    date: '2026-11-09',
    changes: ['Fixed the game freezing when a companion was bought.'],
  },
  {
    version: '1.15.0',
    date: '2026-11-09',
    changes: [
      'Level-ups no longer interrupt the game: XP now banks upgrade points to spend in a shop, opened with B or the Shop button on phones.',
      'The shop has weapons, defense and companions sections.',
      'New health replenishment, and a personal laser that burns incoming bullets, with its own upgrades.',
      'New second companion and team upgrades.',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-11-09',
    changes: ['Admins can set each character\'s time before its first spawn and how many can exist at once.'],
  },
  {
    version: '1.13.1',
    date: '2026-11-09',
    changes: ['Spawn rates are now truly proportional, the Endless boss included.'],
  },
  {
    version: '1.13.0',
    date: '2026-11-09',
    changes: [
      'Brown trees now grow on the wasteland.',
      'Your browser remembers the map and mode you picked.',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-11-09',
    changes: [
      'New Boss attack type: any enemy can fight with the boss\'s fan, ring and charge.',
      'The boss theme keeps playing while you choose an upgrade.',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-11-09',
    changes: ['Each character now has its own spawn chance.'],
  },
  {
    version: '1.10.0',
    date: '2026-11-09',
    changes: [
      'The wasteland gets rubbish hills that stop walkers and bullets.',
      'Signs are now green, solid and as wide as a fence.',
      'Each map has its own spawn settings.',
    ],
  },
  {
    version: '1.9.1',
    date: '2026-11-09',
    changes: ['Admins can drag and drop image and sound files onto the editor.'],
  },
  {
    version: '1.9.0',
    date: '2026-11-09',
    changes: [
      'New map: the White Wasteland, with signs and buses manned by Rocketeers firing guided rockets you can shoot down.',
      'New Endless mode: no hostage, a rare boss, and its own leaderboard.',
      'New kamikaze attack: the enemy slams into its target and dies.',
      'Admins can upload sounds for every character.',
    ],
  },
  {
    version: '1.8.1',
    date: '2026-11-09',
    changes: ['Fixed runs in progress being unable to save their score after a server restart.'],
  },
  {
    version: '1.8.0',
    date: '2026-11-09',
    changes: ['Kh-29 missiles can now only be destroyed by clicking or tapping them. Bullets and auto-aim ignore them.'],
  },
  {
    version: '1.7.1',
    date: '2026-11-09',
    changes: ['Enemies no longer grow in size with the difficulty level.'],
  },
  {
    version: '1.7.0',
    date: '2026-11-09',
    changes: [
      'New difficulty levels, reached by kills, make enemies stronger.',
      'New enemy: the Su-34 jet, firing guided Kh-29 missiles.',
      'Deaths with kills can now join the kill leaderboard.',
      'New fire rate upgrade.',
      'Admins can switch characters off per map.',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-11-09',
    changes: ['New global leaderboard for the fastest rescue and most kills on each map.'],
  },
  {
    version: '1.5.0',
    date: '2026-11-09',
    changes: [
      'New forest map, with trees and wrecked tanks that block movement and bullets.',
      'New Enemy 5, the strongest and rarest enemy, which throws a large ball.',
      'Each map has its own names and characters.',
      'The damage upgrade now adds a percentage of base damage, and the stronger enemy drops more XP.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-11-08',
    changes: ['Enemies now drop XP orbs that lead to a level-up menu with weapon upgrades.'],
  },
  {
    version: '1.3.0',
    date: '2026-11-08',
    changes: ['Aim with the mouse on desktop.'],
  },
  {
    version: '1.2.0',
    date: '2026-11-08',
    changes: [
      'New aim joystick on phones.',
      'Each enemy can have its own attack type.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-08',
    changes: ['Admins can upload character images in almost any format.'],
  },
  {
    version: '1.0.2',
    date: '2026-11-08',
    changes: ['Uploading a character image now opens the phone\'s file browser.'],
  },
  {
    version: '1.0.1',
    date: '2026-11-08',
    changes: ['Server maintenance: tidier logs.'],
  },
  {
    version: '1.0.0',
    date: '2026-11-08',
    changes: ['First release: fight through an endless grid, find the hostage and defeat the boss.'],
  },
];
