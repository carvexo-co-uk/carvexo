import React, { createContext, useContext, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Menu, Volume2, VolumeX, X, MessagesSquare } from 'lucide-react';
import '@fontsource-variable/manrope';
import '@fontsource-variable/space-grotesk';
import '@fontsource/ibm-plex-mono/400.css';
import { defaults } from '../../shared/site-content.js';
import { catalog, staticDemo } from './api.js';
import { Home } from './Home.jsx';
import { Checkout, Confirmation, Pricing } from './Purchase.jsx';
import { audio } from './audio.js';
import './style.css';

const Admin = lazy(() => import('./Admin.jsx'));

const SiteContext = createContext(null);
export const useSite = () => useContext(SiteContext);

const navigation = [
  ['Services', '/#services'], ['Sample report', '/#sample'], ['Reviews', '/#reviews'],
];

export function Brand({ stacked = false }) {
  return <img className={stacked ? 'brand-stacked' : 'brand-image'} src={'/brand/' + (stacked ? 'secondary' : 'primary') + '.png'} alt="Carvexo" width={stacked ? 448 : 903} height={stacked ? 201 : 104} />;
}

function SectionLink({ to, children, ...props }) {
  const location = useLocation();
  return <Link to={to} {...props} onClick={(event) => {
    props.onClick?.(event);
    const id = to.split('#')[1];
    if (id && location.pathname + location.hash === to) {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }
  }}>{children}</Link>;
}

function Header() {
  const { pathname } = useLocation();
  const { sound, audioReady, toggleSound } = useSite();
  const [menu, setMenu] = useState(false);
  const home = pathname === '/';
  useEffect(() => setMenu(false), [pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = (event) => {
      if (event.key === 'Escape') {
        setMenu(false);
        document.getElementById('mobile-menu-trigger')?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);
  return <header className="site-header">
    <div className="shell header-inner">
      <Link to="/" className="brand-link" aria-label="Carvexo homepage"><Brand /></Link>
      <nav className="desktop-nav" aria-label="Main navigation">
        {navigation.map(([title, path]) => <SectionLink key={path} to={path}>{title}</SectionLink>)}
      </nav>
      <div className="header-actions">
        {home && <button type="button" className="sound-toggle" aria-pressed={sound} title={sound && !audioReady ? "Sound starts after you interact with the page" : undefined} onClick={toggleSound}>
          {sound ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}
          <span>Sound {sound ? 'on' : 'off'}</span>
        </button>}
        <SectionLink className="header-check" to="/#registration">Check a vehicle</SectionLink>
        <button type="button" className="mobile-menu-button" id="mobile-menu-trigger" aria-expanded={menu} aria-controls="mobile-menu" aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu(!menu)}>
          {menu ? <X size={23} /> : <Menu size={23} />}
        </button>
      </div>
    </div>
    {menu && <nav className="shell mobile-nav" id="mobile-menu" aria-label="Mobile navigation">
      {navigation.map(([title, path]) => <SectionLink key={path} to={path} onClick={() => setMenu(false)}>{title}</SectionLink>)}
      <SectionLink to="/#registration" onClick={() => setMenu(false)}>Check a vehicle</SectionLink>
    </nav>}
  </header>;
}

function Footer() {
  const { content } = useSite();
  return <footer className="footer">
    <div className="shell footer-main">
      <div className="footer-brand">
        <Link to="/" aria-label="Carvexo homepage"><Brand stacked /></Link>
        <p className="footer-copy">{content.home.footerText}</p>
      </div>
      <div className="footer-links">
        <span className="mono">Reports</span>
        <SectionLink to="/#registration">Check a vehicle</SectionLink>
        <SectionLink to="/#sample">Sample report</SectionLink>
        <SectionLink to="/#faq">FAQs</SectionLink>
      </div>
      <div className="footer-links">
        <span className="mono">Carvexo</span>
        <Link to="/about">About us</Link>
        <Link to="/contact">Contact</Link>
        {content.socials.map(({ name, url }) => <a href={url} key={name + url}>{name}</a>)}
      </div>
      <div className="footer-links">
        <span className="mono">Policies</span>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/refunds">Refunds</Link>
      </div>
    </div>
    <div className="shell footer-bottom">
      <span>© {new Date().getFullYear()} Carvexo</span>
      <span><a href="https://sketchfab.com/3d-models/bmw-m4-competition-m-package-5c0a2dafb1ad408d9fc9eeef9aee531b">BMW M4 model</a> by <a href="https://sketchfab.com/TheRealSRT">SRT Performance</a>, adapted for Carvexo under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></span>
    </div>
  </footer>;
}

function RouteEffects() {
  const { pathname, hash } = useLocation();
  const { content } = useSite();
  useEffect(() => {
    const path = pathname.replace(/\/$/, '') || '/';
    const seo = content.seo[path] ?? defaults.content.seo['/'];
    document.title = path === '/admin' ? 'Admin — CARVEXO' : seo.title;
    for (const [key, value] of [['description', seo.description], ['keywords', seo.keywords], ['og:title', seo.title], ['og:description', seo.description]]) {
      const attribute = key.startsWith('og:') ? 'property' : 'name';
      const meta = document.querySelector(`meta[${attribute}="${key}"]`) || document.createElement('meta');
      meta.setAttribute(attribute, key);
      meta.content = value;
      if (!meta.parentNode) document.head.appendChild(meta);
    }
  }, [pathname, content.seo]);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const main = document.getElementById('main');
    main?.setAttribute('tabindex', '-1');
    const frame = requestAnimationFrame(() => {
      if (hash) {
        const target = document.getElementById(hash.slice(1));
        if (!target) return;
        target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ block: 'start' });
        target.focus({ preventScroll: true });
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
        if (previousPath.current !== pathname) main?.focus({ preventScroll: true });
      }
      previousPath.current = pathname;
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);
  return null;
}

function LiveChat() {
  const { config } = useSite();
  const widget = config?.tawkWidget;
  useEffect(() => {
    if (!widget || document.getElementById('carvexo-tawk')) return;
    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_LoadStart = new Date();
    const script = document.createElement('script');
    script.id = 'carvexo-tawk';
    script.async = true;
    script.src = 'https://embed.tawk.to/' + widget;
    script.charset = 'UTF-8';
    script.setAttribute('crossorigin', '*');
    document.head.appendChild(script);
  }, [widget]);
  return null;
}

function Information({ type }) {
  const { config, content } = useSite();
  const [message, setMessage] = useState('');
  const info = content.info[type];
  if (['privacy', 'terms', 'refunds'].includes(type)) return <main id="main" className="shell text-page">
    <span className="eyebrow">Carvexo policies</span><h1>{info.title}</h1>
    {content[type].length
      ? content[type].map((paragraph, index) => <p key={index}>{paragraph}</p>)
      : <p className="notice">This policy will be available before Carvexo accepts live orders.</p>}
    <Link to="/" className="button button-outline">Return to homepage</Link>
  </main>;
  if (type === 'about') return <main id="main" className="shell text-page">
    <span className="eyebrow">About us</span>
    <h1>{info.title}</h1>
    {info.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    {content.businessName && <p>{content.businessName}<br />{content.businessAddress}</p>}
    <SectionLink to="/#registration" className="button">Check a vehicle</SectionLink>
  </main>;
  return <main id="main" className="shell text-page">
    <span className="eyebrow">Support</span>
    <h1>{info.title}</h1>
    {info.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
    <div className="support-actions">
      {content.phone && <a className="button button-outline" href={'tel:' + content.phone.replace(/[^+\d]/g, '')}>{content.phone}</a>}
      {content.supportEmail && <a className="button" href={'mailto:' + content.supportEmail}>Email Carvexo</a>}
      {config?.tawkWidget && <button className="button button-outline" onClick={() => {
        if (typeof window.Tawk_API?.maximize === 'function') window.Tawk_API.maximize();
        else setMessage('Live chat is still loading. Try again in a moment.');
      }}><MessagesSquare size={18} /> Start a chat</button>}
      {!config?.tawkWidget && !content.supportEmail && !content.phone && <p className="notice">Support contact details will be published before live orders open.</p>}
    </div>
    {message && <p role="status">{message}</p>}
    <SectionLink to="/#faq" className="quiet-link">Read frequently asked questions</SectionLink>
  </main>;
}

function Application() {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState('');
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem('carvexo.sound') !== 'off'; } catch { return true; }
  });
  const [audioReady, setAudioReady] = useState(false);
  const { pathname } = useLocation();
  const path = pathname.replace(/\/$/, '') || '/';
  useEffect(() => {
    if (!sound || path !== '/' || audioReady) return;
    let active = true;
    const unlock = (event) => {
      if (event?.target.closest?.('.sound-toggle')) return;
      audio.enable().then(() => { if (active) setAudioReady(audio.enabled); }).catch(() => {});
    };
    if (navigator.getAutoplayPolicy?.('audiocontext') === 'allowed') unlock();
    document.addEventListener('click', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      active = false;
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [sound, audioReady, path]);
  useEffect(() => {
    const elements = document.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add('reveal-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: .1 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [path]);
  const refresh = () => {
    setConfigError('');
    catalog().then(setConfig).catch(() => setConfigError('The checkout service is temporarily unavailable.'));
  };
  useEffect(refresh, []);
  function toggleSound() {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem('carvexo.sound', next ? 'on' : 'off'); } catch {}
    if (next) audio.enable().then(() => setAudioReady(audio.enabled)).catch(() => {});
    else { audio.disable(); setAudioReady(false); }
  }
  const content = config?.content ?? defaults.content;
  return <SiteContext.Provider value={{ config, content, configError, refresh, sound, audioReady, toggleSound }}>
    <RouteEffects />
    {path !== '/admin' && <LiveChat />}
    <a className="skip-link" href="#main">Skip to content</a>
    {path !== '/admin' && <Header />}
    <div className="route-transition" key={path}><Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<Suspense fallback={<main id="main" className="shell text-page">Loading admin…</main>}><Admin /></Suspense>} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/confirmation" element={<Confirmation />} />
      <Route path="/about" element={<Information type="about" />} />
      <Route path="/contact" element={<Information type="contact" />} />
      {['privacy', 'terms', 'refunds'].map((type) => <Route path={'/' + type} key={type} element={<Information type={type} />} />)}
      <Route path="*" element={<main id="main" className="shell text-page">
        <h1>Page not found.</h1><Link to="/" className="button">Return to homepage</Link>
      </main>} />
    </Routes></div>
    {path !== '/admin' && <Footer />}
  </SiteContext.Provider>;
}

if (location.pathname.replace(/\/$/, '') === '/confirmation') {
  const url = new URL(location.href);
  for (const name of ['payment_intent', 'payment_intent_client_secret', 'redirect_status']) {
    url.searchParams.delete(name);
  }
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

if (staticDemo) {
  const meta = document.createElement('meta');
  meta.name = 'robots';
  meta.content = 'noindex, nofollow';
  document.head.appendChild(meta);
}

createRoot(document.getElementById('root')).render(<BrowserRouter><Application /></BrowserRouter>);
