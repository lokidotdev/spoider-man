const ADJECTIVES = [
  'Swift', 'Shadow', 'Crimson', 'Silent', 'Iron', 'Neon', 'Rapid', 'Wild',
  'Turbo', 'Cosmic', 'Vivid', 'Frost', 'Blazing', 'Sly', 'Grim', 'Lucky',
  'Static', 'Rogue', 'Atomic', 'Velvet', 'Hollow', 'Prime', 'Zesty', 'Mad',
];

const NOUNS = [
  'Falcon', 'Wolf', 'Comet', 'Viper', 'Raven', 'Tiger', 'Drifter', 'Spider',
  'Hornet', 'Phantom', 'Rocket', 'Bandit', 'Nomad', 'Jaguar', 'Cyclone', 'Otter',
  'Marlin', 'Gecko', 'Puma', 'Kestrel', 'Badger', 'Lynx', 'Mantis', 'Ferret',
];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** e.g. "SwiftFalcon42" — unique within the given set of taken names. */
export function randomName(taken: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const name = `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(Math.random() * 90) + 10}`;
    if (!taken.has(name)) return name;
  }
  return `Player${Math.floor(Math.random() * 100000)}`;
}
