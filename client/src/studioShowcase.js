const smooth = (value, start, end) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
};

export const separation = {
  Nose: [-.98, .055, 0],
  Bonnet: [-.24, .62, 0],
  Rear: [.87, .12, 0],
  Body: [.04, .48, 0],
  Glass: [0, .75, 0],
  DoorLeft: [.12, .10, .74],
  DoorRight: [.12, .10, -.72],
  WheelFL: [-.28, .02, .75],
  WheelFR: [-.28, .02, -.72],
  WheelRL: [.31, .02, .75],
  WheelRR: [.31, .02, -.72],
};

export const showcaseSheet = { frames: 20, columns: 5, width: 630, height: 408 };

export function showcasePose(chapter, progress) {
  if (chapter === 1) {
    const reveal = smooth(progress, .04, .39) * (1 - smooth(progress, .60, .97));
    return { split: reveal * .90, yaw: reveal * .31, pullback: reveal * .27 };
  }
  if (chapter === 2) {
    const turn = smooth(progress, .04, .97);
    const yaw = 2 * Math.PI * turn;
    return { split: 0, yaw, pullback: Math.sin(Math.PI * turn) * .12 };
  }
  return { split: 0, yaw: 0, pullback: 0 };
}

export function partSpread(name, split) {
  if (name.startsWith('Wheel') || name.startsWith('Door')) return split;
  return split * smooth(split, 0, name === 'Body' || name === 'Glass' ? .50 : .28);
}

export function showcaseMix(progress) {
  return smooth(progress, .025, .095) * (1 - smooth(progress, .91, .986));
}
