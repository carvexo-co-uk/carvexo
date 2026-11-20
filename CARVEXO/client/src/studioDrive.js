const GESTURE_PAUSE_MS = 190;
const MAX_METRES_PER_SECOND = 3.4;
const TYRE_RADIUS = .357;
const TYRE_CIRCUMFERENCE = 2 * Math.PI * TYRE_RADIUS;
export const WHEEL_FRAME_COUNT = 32;

export function readDriveWheel(event, speed, previous) {
  const pixels = event.deltaY * ([1, 16, 160][event.deltaMode] ?? 1);
  const direction = Math.sign(pixels);
  const discrete = event.deltaMode > 0;
  const newGesture = !previous || event.timeStamp - previous.time > GESTURE_PAUSE_MS
    || (discrete && Math.abs(pixels) >= 16);
  const atLimit = direction > 0 ? speed >= 1 : speed <= 0;
  const pass = newGesture ? atLimit : previous.pass && previous.direction === direction;
  const change = Math.max(-.18, Math.min(.18, pixels / 800));
  const next = Math.max(0, Math.min(1, speed + change));
  return {
    gesture: { time: event.timeStamp, direction, pass },
    speed: pass ? speed : next,
    consume: !pass,
  };
}

export function advanceDrive(drive, target, seconds) {
  const amount = Math.min(1, seconds * 2.8);
  let speed = drive.speed + Math.sign(target - drive.speed) * Math.min(amount, Math.abs(target - drive.speed));
  if (Math.abs(target - speed) < .0001) speed = target;
  const distance = drive.distance + (drive.speed + speed) / 2 * MAX_METRES_PER_SECOND * seconds;
  return { speed, distance };
}

export function wheelFrame(distance) {
  return Math.floor(distance / TYRE_CIRCUMFERENCE * WHEEL_FRAME_COUNT) % WHEEL_FRAME_COUNT;
}


export function drivePose(distance, mobile) {
  return {
    x: -(distance % 2048),
    wheelAngle: (distance % TYRE_CIRCUMFERENCE) / TYRE_RADIUS,
    screenX: (mobile ? .07 : .22) * Math.expm1(-distance / 10),
  };
}
