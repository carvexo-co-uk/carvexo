import { writeFileSync } from 'node:fs';
import { showcaseSheet, showcasePose, separation, partSpread } from '../client/src/studioShowcase.js';

const destination = process.argv[2];
if (!destination) throw new Error('Provide the output path for the showcase poses.');
const shots = ['coverage', 'inspection'].map((name, index) => ({
  name,
  frames: Array.from({ length: showcaseSheet.frames }, (_, frame) => {
    const pose = showcasePose(index + 1, frame / (showcaseSheet.frames - 1));
    const parts = Object.fromEntries(Object.entries(separation).map(([part, offset]) => {
      const spread = partSpread(part, pose.split);
      return [part, { offset: offset.map((value) => value * spread), spread }];
    }));
    return { ...pose, parts };
  }),
}));
writeFileSync(destination, JSON.stringify(shots));
