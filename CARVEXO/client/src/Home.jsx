import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, CircleHelp, FileText, Gauge, IdCard, Mail, Plus, ScanLine, ShieldCheck, Quote } from 'lucide-react';
import { registrationFrom } from '../../shared/catalog.js';
import { readSession, saveRegistration } from './api.js';
import { audio } from './audio.js';
import { advanceDrive, drivePose, readDriveWheel, wheelFrame } from './studioDrive.js';
import { showcaseMix, showcaseSheet } from './studioShowcase.js';
import { useSite } from './main.jsx';

const Studio = lazy(() => import('./Studio.jsx'));
const chapters = ['reveal', 'coverage', 'inspection', 'drive'];

const wheelPatches = [
  { x: 248, y: 306, width: 120, height: 136, tileX: 0 },
  { x: 563, y: 258, width: 92, height: 110, tileX: 120 },
];

function StudioArtwork({ wheels, showcase }) {
  return <>
    <img className="studio-poster" src="/scene/studio.webp" width="840" height="544" alt="" fetchPriority="high" />
    <canvas className="studio-poster studio-wheels" width="840" height="544" ref={wheels} />
    <canvas className="studio-poster studio-showcase" width="840" height="544" ref={showcase} />
  </>;
}

function Registration() {
  const navigate = useNavigate();
  const { content: { home } } = useSite();
  const [value, setValue] = useState(readSession().registration ?? '');
  const [error, setError] = useState('');
  const input = useRef(null);
  function submit(event) {
    event.preventDefault();
    const registration = registrationFrom(value);
    if (!registration) {
      setError('Enter a UK registration number, for example AB12 CDE.');
      input.current.focus();
      return;
    }
    saveRegistration(registration.display);
    navigate('/pricing', { state: { registrationSplash: true } });
  }
  return <section id="registration" className="registration" aria-labelledby="registration-title">
    <form className="registration-form" onSubmit={submit} noValidate>
      <label id="registration-title" htmlFor="reg">{home.registrationLabel}</label>
      <div className={'plate-field' + (error ? ' plate-invalid' : '')}>
        <span className="plate-country" aria-hidden="true"><ScanLine size={20} strokeWidth={1.6} /></span>
        <input id="reg" ref={input} value={value} placeholder="e.g. AB12 CDE" maxLength={24}
          autoCapitalize="characters" autoComplete="off" spellCheck="false" aria-invalid={!!error}
          aria-describedby={error ? 'registration-error' : undefined}
          onChange={(event) => { setValue(event.target.value.toUpperCase()); setError(''); }} />
      </div>
      <button className="button">{home.registrationButton}</button>
      {error && <span role="alert" className="field-error" id="registration-error">{error}</span>}
    </form>
  </section>;
}

function Coverage({ canInspect, inspecting, toggleInspection }) {
  const { content: { home } } = useSite();
  const icons = [IdCard, Gauge, ScanLine];
  return <section id="coverage" className="chapter shell coverage" aria-labelledby="coverage-title">
    <div className="chapter-copy" data-reveal>
      <span className="eyebrow">{home.coverageEyebrow}</span>
      <h2 id="coverage-title">{home.coverageHeading}</h2>
      <p className="lead">{home.coverageIntro}</p>
      <div className="coverage-list">
        {home.coverageTopics.map(([title, text], index) => {
          const Icon = icons[index % icons.length];
          return <div className="coverage-item" key={index}>
          <Icon size={21} strokeWidth={1.55} aria-hidden="true" />
          <div><h3>{title}</h3><p>{text}</p></div>
        </div>; })}
      </div>
      <p className="aside">{home.coverageNote}</p>
      {canInspect && <button type="button" className="button button-outline orbit-button" aria-pressed={inspecting} onClick={toggleInspection}>
        {inspecting ? 'Close exploded view' : 'Open exploded view'}
      </button>}
    </div>
  </section>;
}

function Inspection({ orbit, setOrbit, canOrbit }) {
  const { content: { home } } = useSite();
  return <section id="sample" className="chapter shell sample" aria-labelledby="sample-title">
    <div className="chapter-copy" data-reveal>
      <span className="eyebrow">{home.sampleEyebrow}</span>
      <h2 id="sample-title">{home.sampleHeading}</h2>
      <p className="lead">{home.sampleIntro}</p>
      <div className="sample-report">
        <div className="sample-head">
          <FileText size={23} strokeWidth={1.45} aria-hidden="true" />
          <div><strong>Illustrative report</strong><small>Fictional vehicle · no live data</small></div>
        </div>
        <dl className="sample-specs">
          <div><dt>Vehicle</dt><dd>2018 example coupé</dd></div>
          <div><dt>Fuel type</dt><dd>Petrol</dd></div>
        </dl>
        <ol className="timeline">
          <li><time dateTime="2018-09-12">Sep 2018</time><span>First registration recorded</span></li>
          <li><time dateTime="2022-09-16">Sep 2022</time><span>Mileage recorded · 24,180 mi</span></li>
          <li><time dateTime="2025-09-17">Sep 2025</time><span>Mileage recorded · 43,820 mi</span></li>
        </ol>
        <p className="sample-note">“Recorded” indicates an entry in the available data.</p>
      </div>
      {canOrbit && <button type="button" className="button button-outline orbit-button" aria-pressed={orbit} onClick={() => setOrbit(!orbit)}>
        {orbit ? 'Close inspection' : 'Inspect the model'}
      </button>}
    </div>
  </section>;
}

function HowItWorks({ speed, setSpeed }) {
  const { content: { home } } = useSite();
  const icons = [ScanLine, FileText, Mail];
  return <section id="how-it-works" className="chapter shell how" aria-labelledby="how-title">
    <div className="chapter-copy" data-reveal>
      <span className="eyebrow">{home.howEyebrow}</span><h2 id="how-title">{home.howHeading}</h2>
      <div className="how-list">
        {home.howSteps.map(([title, text], index) => {
          const Icon = icons[index % icons.length];
          return <div className="how-item" key={index}>
          <span className="small-icon"><Icon size={19} strokeWidth={1.6} aria-hidden="true" /></span>
          <div><h3>{title}</h3><p>{text}</p></div>
        </div>; })}
      </div>
      <div className="drive-actions">
        <a className="button" href="#registration">{home.howButton}</a>
      </div>
      <div className="drive-throttle">
        <div className="drive-throttle-label">
          <label htmlFor="drive-speed">Drive speed</label>
          <output htmlFor="drive-speed" aria-live="off">{speed}%</output>
        </div>
        <input id="drive-speed" type="range" min="0" max="100" step="1" value={speed}
          aria-describedby="drive-instructions" aria-valuetext={speed + ' percent'}
          onChange={(event) => setSpeed(Number(event.target.value) / 100)} />
        <p id="drive-instructions">Scroll down to speed up, or up to slow down. Scroll again at either limit to continue through the page.</p>
      </div>
    </div>
  </section>;
}

function LowerSections() {
  const { content } = useSite();
  const { faqs, home, reviews, services } = content;
  const icons = [FileText, ShieldCheck, Mail];
  return <>
    <section className="why-section" data-reveal>
      <div className="shell why-inner">
        <div><span className="eyebrow">{home.whyEyebrow}</span>
          <h2>{home.whyHeading}</h2>
          <Link to="/about" className="quiet-link">{home.whyButton}</Link>
        </div>
        <div className="why-points">
          {home.whyPoints.map((point, index) => <p key={index}><Check size={19} /> {point}</p>)}


        </div>
      </div>
    </section>
    <section id="services" className="shell services-section" aria-labelledby="services-title" data-reveal>
      <h2 id="services-title">{home.servicesHeading}</h2>
      <div className="services-grid">
        {services.map(([title, description], index) => {
          const Icon = icons[index % icons.length];
          return <article key={index}><Icon aria-hidden="true" /><h3>{title}</h3><p>{description}</p></article>;
        })}
      </div>
    </section>
    <section id="reviews" className="shell review-section" aria-labelledby="reviews-title" data-reveal>
      <span className="eyebrow">{home.reviewsEyebrow}</span>
      <h2 id="reviews-title">{home.reviewsHeading}</h2>
      {reviews.length ? <div className="review-grid">{reviews.map(({ quote, name }) =>
        <figure key={name + quote}><Quote size={21} aria-hidden="true" /><blockquote>{quote}</blockquote><figcaption>{name}</figcaption></figure>)}</div>
        : <p className="reviews-empty">{home.reviewsEmpty}</p>}
    </section>
    <section id="faq" className="shell faq-section" data-reveal aria-labelledby="faq-title">
      <div className="faq-intro">
        <span className="eyebrow">{home.faqEyebrow}</span>
        <h2 id="faq-title">{home.faqHeading}</h2>
        <Link to="/contact" className="button button-outline"><CircleHelp size={18} /> {home.faqButton}</Link>
      </div>
      <div className="faq-list">
        {faqs.map(([question, answer], index) => <details key={index}>
          <summary>{question}<Plus size={19} aria-hidden="true" /></summary><p>{answer}</p>
        </details>)}
      </div>
    </section>
  </>;
}

export function Home() {
  const story = useRef(null);
  const stage = useRef(null);
  const motion = useRef({ position: 0, chapter: 0, visible: true });
  const reducedMotion = useRef(false);
  const liveStudio = useRef(false);
  const speedTarget = useRef(0);
  const wheels = useRef(null);
  const showcase = useRef(null);
  const wakeDrive = useRef(null);
  const [chapter, setChapter] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [ready, setReady] = useState(false);
  const [studioUnavailable, setStudioUnavailable] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [manualReduced, setManualReduced] = useState(() => {
    try { return localStorage.getItem('carvexo.reducedMotion') === 'true'; } catch { return false; }
  });
  const reduced = systemReduced || manualReduced;
  const { sound, audioReady, content: { home } } = useSite();
  const onStudioReady = useCallback((available, canRecover = false) => {
    liveStudio.current = available;
    setReady(available);
    if (!available && !canRecover) {
      setStudioUnavailable(true);
      setInspecting(false);
    }
    wakeDrive.current?.();
  }, []);
  const setThrottle = useCallback((value) => {
    speedTarget.current = value;
    const percent = Math.round(value * 100);
    setSpeed(value === 0 || value === 1 ? percent : Math.max(1, Math.min(99, percent)));
    wakeDrive.current?.();
  }, []);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setSystemReduced(preference.matches);
    preference.addEventListener('change', updatePreference);
    const landmarks = ['coverage', 'sample', 'how-it-works'].map((id) => document.getElementById(id));
    const driveSection = landmarks[2];
    const throttle = driveSection.querySelector('.drive-throttle');
    const scene = story.current;
    const context = wheels.current.getContext('2d');
    const showcaseCanvas = showcase.current;
    const showcaseContext = showcaseCanvas.getContext('2d');
    const showcaseImages = [new Image(), new Image()];
    let showcaseRequested = false;
    let lastShowcase;
    const atlas = new Image();
    let atlasRequested = false;
    let previousWheel = -1;
    let frame;
    let driveFrame;
    let previousTime;
    let wheelGesture;
    let drive = { speed: 0, distance: 0 };

    function showWheels(index) {
      if (!context || !atlas.complete || !atlas.naturalWidth || index === previousWheel) return;
      previousWheel = index;
      const tileX = (index % 8) * 212;
      const tileY = Math.floor(index / 8) * 136;
      for (const patch of wheelPatches) {
        const { x, y, width, height } = patch;
        context.clearRect(x, y, width, height);
        context.drawImage(atlas, tileX + patch.tileX, tileY, width, height, x, y, width, height);
      }
    }

    function drawShowcase(chapter, progress) {
      const opacity = !liveStudio.current && !reducedMotion.current && (chapter === 1 || chapter === 2)
        ? showcaseMix(progress) : 0;
      if (!opacity || !showcaseContext) {
        showcaseCanvas.style.setProperty('--showcase-opacity', '0');
        return;
      }
      if (!showcaseRequested) {
        showcaseRequested = true;
        showcaseImages[0].src = '/scene/bmw-showcase-coverage.webp';
        showcaseImages[1].src = '/scene/bmw-showcase-inspection.webp';
      }
      const image = showcaseImages[chapter - 1];
      if (!image.complete || !image.naturalWidth) {
        showcaseCanvas.style.setProperty('--showcase-opacity', '0');
        return;
      }
      showcaseCanvas.style.setProperty('--showcase-opacity', String(opacity));
      const { frames, columns, width, height } = showcaseSheet;
      const exactFrame = progress * (frames - 1);
      const index = Math.round(exactFrame);
      const key = chapter + ':' + index;
      if (key === lastShowcase) return;
      lastShowcase = key;
      showcaseContext.clearRect(0, 0, showcaseCanvas.width, showcaseCanvas.height);
      showcaseContext.drawImage(image, index % columns * width, Math.floor(index / columns) * height,
        width, height, 0, 0, showcaseCanvas.width, showcaseCanvas.height);
    }

    function runDrive(now) {
      driveFrame = undefined;
      if (motion.current.chapter !== 3 || document.hidden || !motion.current.visible) {
        previousTime = undefined;
        return;
      }
      if (!atlasRequested && !liveStudio.current && !reducedMotion.current) {
        atlasRequested = true;
        atlas.src = '/scene/bmw-wheels.webp';
      }
      const seconds = previousTime === undefined ? 0 : Math.min((now - previousTime) / 1000, .08);
      previousTime = now;
      drive = advanceDrive(drive, speedTarget.current, seconds);
      motion.current.drive = drive;
      audio.update(drive.speed, true);
      if (!reducedMotion.current) {
        scene.style.setProperty('--road-offset', (drive.distance * 90) % 56 + 'px');
        scene.style.setProperty('--road-intensity', String(drive.speed));
        const pose = drivePose(drive.distance, innerWidth <= 820);
        scene.style.setProperty('--car-travel', (pose.screenX * 50) + 'vw');
        if (!liveStudio.current) showWheels(wheelFrame(drive.distance));
      }
      if (drive.speed || speedTarget.current) scheduleDrive();
      else previousTime = undefined;
    }

    function scheduleDrive() {
      if (driveFrame === undefined) driveFrame = requestAnimationFrame(runDrive);
    }

    const queue = () => { if (frame === undefined) frame = requestAnimationFrame(update); };
    function update() {
      frame = undefined;
      const screen = window.innerHeight;
      const starts = landmarks.map((item) => item.getBoundingClientRect().top - screen * .67);
      let position = 0;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= 0) {
          const length = Math.max(200, (starts[i + 1] ?? starts[i] + screen) - starts[i]);
          position = i + 1 + Math.min(.999, -starts[i] / length);
        }
      }
      const previous = motion.current.chapter;
      const next = Math.floor(position);
      motion.current.position = position;
      motion.current.chapter = next;
      drawShowcase(next, position - next);
      if (previous === next) return;
      setChapter(next);
      setInspecting(false);
      wheelGesture = undefined;
      if (next === 3) {
        scheduleDrive();
      } else if (previous === 3) {
        audio.update(0, false);
        drive = { ...drive, speed: 0 };
        motion.current.drive = drive;
        previousTime = undefined;
        scene.style.setProperty('--road-intensity', '0');
      }
    }

    function onWheel(event) {
      if (reducedMotion.current || event.ctrlKey || !event.cancelable || !event.deltaY
        || Math.abs(event.deltaX) > Math.abs(event.deltaY) || motion.current.chapter !== 3) return;
      const bounds = driveSection.getBoundingClientRect();
      const control = throttle.getBoundingClientRect();
      if (bounds.bottom < innerHeight * .58 || control.top > innerHeight - 40 || control.bottom < 70) return;
      const next = readDriveWheel(event, speedTarget.current, wheelGesture);
      wheelGesture = next.gesture;
      if (!next.consume) return;
      event.preventDefault();
      if (next.speed !== speedTarget.current) setThrottle(next.speed);
    }

    wakeDrive.current = scheduleDrive;
    atlas.onload = scheduleDrive;
    showcaseImages.forEach((image) => { image.onload = queue; });
    update();
    scene.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    const watcher = new IntersectionObserver(([entry]) => {
      motion.current.visible = entry.isIntersecting && !document.hidden;
      if (!motion.current.visible) audio.update(0, false);
      else scheduleDrive();
    });
    watcher.observe(stage.current);
    const visibility = () => {
      const box = stage.current.getBoundingClientRect();
      motion.current.visible = !document.hidden && box.bottom > 0 && box.top < innerHeight;
      previousTime = undefined;
      if (!motion.current.visible) audio.update(0, false);
      else scheduleDrive();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(driveFrame);
      wakeDrive.current = null;
      atlas.onload = null;
      showcaseImages.forEach((image) => { image.onload = null; });
      preference.removeEventListener('change', updatePreference);
      scene.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', queue);
      window.removeEventListener('resize', queue);
      document.removeEventListener('visibilitychange', visibility);
      watcher.disconnect();
      audio.update(0, false);
    };
  }, [setThrottle]);
  useEffect(() => {
    reducedMotion.current = reduced;
    if (reduced) {
      setInspecting(false);
      liveStudio.current = false;
      setReady(false);
      setThrottle(0);
      story.current.style.setProperty('--road-intensity', '0');
    } else wakeDrive.current?.();
  }, [reduced, setThrottle]);
  useEffect(() => {
    if (sound && audioReady && chapter === 0) audio.cue('ignition');
  }, [sound, audioReady, chapter]);

  const canInspect = ready && !reduced && !studioUnavailable;
  const toggleInspection = () => setInspecting((open) => !open);

  return <main id="main">
    <div className="scene-story" ref={story} data-chapter={chapters[chapter]} data-motion={reduced ? 'reduced' : 'normal'}>
      <div className="sticky-stage" ref={stage} aria-hidden="true">
        <div className={'studio-view' + (ready ? ' is-live' : '')}>
          <div className="studio-halo" />
          <StudioArtwork wheels={wheels} showcase={showcase} />
          {!reduced && !studioUnavailable && <Suspense fallback={null}>
            <Studio motion={motion} inspectionChapter={inspecting ? chapter : -1} orbit={inspecting && chapter === 2} onReady={onStudioReady} />
          </Suspense>}
        </div>
      </div>
      <div className="shell hero">
        <div className="hero-copy">
          <span className="eyebrow">{home.eyebrow}</span>
          <h1>{home.heading}<br className="hero-break" /> <em>{home.accent}</em></h1>
          <p>{home.intro}</p>
          <Registration />
          <div className="hero-actions">
            {!systemReduced && <button type="button" className="motion-toggle" aria-pressed={manualReduced} onClick={() => {
              const next = !manualReduced;
              setManualReduced(next);
              try { localStorage.setItem('carvexo.reducedMotion', String(next)); } catch {}
            }}>Reduce motion</button>}
          </div>
        </div>
      </div>
      <Coverage canInspect={canInspect && chapter === 1} inspecting={inspecting} toggleInspection={toggleInspection} />
      <Inspection orbit={inspecting} setOrbit={toggleInspection} canOrbit={canInspect && chapter === 2} />
      <HowItWorks speed={speed} setSpeed={setThrottle} />
    </div>
    <LowerSections />
  </main>;
}
