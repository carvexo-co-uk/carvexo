import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPrice } from '../../shared/catalog.js';
import { pageNames } from '../../shared/site-content.js';
import { request, staticDemo } from './api.js';
import { useSite } from './main.jsx';
import './admin.css';

const tabs = ['Orders', 'Packages', 'Content', 'SEO', 'Payments'];
const emailLabels = {
  'pending-owner': 'Owner checkout lead',
  'demo-owner': 'Owner demo confirmation',
  'demo-customer': 'Customer demo confirmation',
  'paid-owner': 'Owner paid order',
  'paid-customer': 'Customer payment confirmation',
};
const labelFor = key => key.replace(/([A-Z])/g, ' $1').replace(/^./, character => character.toUpperCase());
const statusFor = key => labelFor(key.replaceAll('_', ' '));
const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean);
const paragraphs = value => value.split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);

function Field({ label, help, multiline, ...props }) {
  return <label className="admin-field">
    <span>{label}</span>
    {multiline ? <textarea rows={4} {...props} /> : <input {...props} />}
    {help && <small>{help}</small>}
  </label>;
}

function editField(label, value, onChange, extra = {}) {
  return <Field key={label} label={label} value={value ?? ''} onChange={event => onChange(event.target.value)} {...extra} />;
}

function listField(label, values, onChange, paragraphMode = false) {
  return <Field key={label} label={label} multiline defaultValue={values.join(paragraphMode ? '\n\n' : '\n')}
    help={paragraphMode ? 'Leave a blank line between paragraphs.' : 'One entry per line.'}
    onChange={event => onChange((paragraphMode ? paragraphs : lines)(event.target.value))} />;
}

function Rows({ title, names, values, onChange }) {
  return <fieldset className="admin-section">
    <legend>{title}</legend>
    {values.map((value, index) => <div className="admin-row" key={index}>
      {names.map((name, column) => editField(name + ' ' + (index + 1), value[column], text =>
        onChange(values.map((row, i) => i === index ? row.map((cell, j) => j === column ? text : cell) : row)),
      { multiline: column === 1 && name !== 'URL' }))}
      <button className="button button-outline" type="button" onClick={() => onChange(values.filter((_, i) => index !== i))}
        aria-label={'Remove ' + title + ' entry ' + (index + 1)}>Remove</button>
    </div>)}
    <button className="button button-outline" type="button" onClick={() => onChange([...values, names.map(() => '')])}>Add entry</button>
  </fieldset>;
}

function PackageFields({ settings, change }) {
  return <div className="admin-grid">{settings.packages.map((item, index) => {
    const update = (key, value) => change(['packages', index, key], value);
    return <fieldset className="admin-section" key={item.key}>
      <legend>{item.key === 'basic' ? 'Basic package' : 'Full package'}</legend>
      {editField('Package name', item.title, value => update('title', value), { required: true, maxLength: 100 })}
      <Field label="Price in GBP" defaultValue={item.amount / 100} type="number" min="1" max="5000" step="0.01" required
        onChange={event => update('amount', Math.round(Number(event.target.value) * 100))} />
      {editField('Description', item.description, value => update('description', value), { multiline: true })}
      {listField('Included features', item.features, value => update('features', value))}
      {listField('Excluded features', item.excluded, value => update('excluded', value))}
      {editField('Display order', item.position, value => update('position', Number(value)), { type: 'number', min: '0', max: '99', required: true })}
      <label className="admin-checkbox"><input type="checkbox" checked={item.enabled}
        onChange={event => update('enabled', event.target.checked)} /> Available at checkout</label>
    </fieldset>;
  })}</div>;
}

function ContentFields({ settings, change }) {
  const { content, notifications } = settings;
  const [section, setSection] = useState('home');
  const update = (key, value) => change(['content', key], value);
  const rowFields = [['coverageTopics', 'Report coverage topics'], ['howSteps', 'How it works steps']];
  return <>
    <label className="admin-field"><span>Content section</span>
      <select value={section} onChange={event => setSection(event.target.value)}>
        {Object.entries({ home: 'Homepage copy', services: 'Services, FAQs and reviews', pages: 'About and policy pages',
          contacts: 'Contact and notification settings' }).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
      </select>
    </label>
    {section === 'home' && <>
      <fieldset className="admin-section admin-grid"><legend>Homepage copy</legend>
        {Object.entries(content.home).filter(([, value]) => typeof value === 'string')
          .map(([key, value]) => editField(labelFor(key), value, text => change(['content', 'home', key], text),
            { multiline: ['intro', 'coverageIntro', 'sampleIntro', 'footerText'].includes(key) }))}
        {listField('Why Carvexo points', content.home.whyPoints, value => change(['content', 'home', 'whyPoints'], value))}
      </fieldset>
      {rowFields.map(([key, title]) => <Rows key={key} title={title} names={['Title', 'Text']} values={content.home[key]}
        onChange={value => change(['content', 'home', key], value)} />)}
    </>}
    {section === 'services' && <>
      <Rows title="Services" names={['Title', 'Description']} values={content.services} onChange={value => update('services', value)} />
      <Rows title="FAQs" names={['Question', 'Answer']} values={content.faqs} onChange={value => update('faqs', value)} />
      <Rows title="Customer reviews" names={['Customer name', 'Review']} values={content.reviews.map(({ name, quote }) => [name, quote])}
        onChange={value => update('reviews', value.map(([name, quote]) => ({ name, quote })))} />
    </>}
    {section === 'pages' && <div className="admin-grid">
      {['about', 'contact', 'privacy', 'terms', 'refunds'].map(key => <fieldset className="admin-section" key={key}>
        <legend>{pageNames['/' + key]}</legend>
        {editField('Page heading', content.info[key].title, value => change(['content', 'info', key, 'title'], value))}
        {listField('Page text', content.info[key].body ?? content[key], value =>
          change(content.info[key].body ? ['content', 'info', key, 'body'] : ['content', key], value), true)}
      </fieldset>)}
    </div>}
    {section === 'contacts' && <>
      <fieldset className="admin-section admin-grid"><legend>Contact and notification settings</legend>
        {[
          ['supportEmail', 'Public support email', 'email'], ['phone', 'Public phone number', 'tel'],
          ['businessName', 'Business name', 'text'], ['businessAddress', 'Business address', 'text'],
          ['turnaround', 'Report delivery time', 'text'],
        ].map(([key, label, type]) => editField(label, content[key], value => update(key, value), { type }))}
        {editField('Owner notification email', notifications.ownerEmail, value => change(['notifications', 'ownerEmail'], value), { type: 'email', required: true })}
        {editField('Customer email reply-to', notifications.replyTo, value => change(['notifications', 'replyTo'], value), { type: 'email', required: true })}
      </fieldset>
      <Rows title="Social links" names={['Platform', 'URL']} values={content.socials.map(({ name, url }) => [name, url])}
        onChange={value => update('socials', value.map(([name, url]) => ({ name, url })))} />
    </>}
  </>;
}

function SeoFields({ settings, change }) {
  return <div className="admin-grid">{Object.entries(pageNames).map(([path, title]) => <fieldset className="admin-section" key={path}>
    <legend>{title}</legend>
    {[['title', 'SEO title'], ['description', 'Meta description'], ['keywords', 'Target keywords']]
      .map(([key, label]) => editField(label, settings.content.seo[path][key],
        value => change(['content', 'seo', path, key], value), { multiline: key === 'description' }))}
  </fieldset>)}</div>;
}

function PaymentFields({ settings, gateways, mailMode, change }) {
  const [checks, setChecks] = useState({});
  async function check(provider) {
    setChecks(previous => ({ ...previous, [provider]: { busy: true, text: '' } }));
    try {
      const result = await request('/admin/payments/' + provider + '/check', 'POST');
      const verified = result.webhookVerified === false ? 'Sandbox connection verified · Local return only'
        : 'Connection and webhook verified · ' + result.environment;
      setChecks(previous => ({ ...previous, [provider]: { text: verified } }));
    } catch (error) {
      setChecks(previous => ({ ...previous, [provider]: { text: error.message } }));
    }
  }
  return <>
    <fieldset className="admin-section">
      <legend>Checkout methods</legend>
      <label className="admin-checkbox"><input type="checkbox" checked={settings.payment.demoEnabled}
        onChange={event => change(['payment', 'demoEnabled'], event.target.checked)} /> Enable Cash on Delivery demo when online checkout is off</label>
      <label className="admin-field"><span>Online payment provider</span>
        <select value={settings.payment.provider} onChange={event => change(['payment', 'provider'], event.target.value)}>
          <option value="">Online payments off</option>
          <option value="stripe" disabled={!gateways.stripe.ready}>Stripe</option>
          <option value="paypal" disabled={!gateways.paypal.ready}>PayPal</option>
        </select>
      </label>
      <p>Email transport: {mailMode === 'capture' ? 'Demo capture' : 'Resend'}</p>
    </fieldset>
    <div className="admin-grid">{Object.entries(gateways).map(([provider, state]) => <fieldset className="admin-section" key={provider}>
      <legend>{provider === 'stripe' ? 'Stripe' : 'PayPal'}</legend>
      <p>{state.ready ? (state.live ? 'Live credentials configured' : 'Sandbox credentials configured')
        : state.configured ? 'Awaiting live activation configuration' : 'Server credentials required'}</p>
      <button type="button" className="button button-outline" disabled={!state.ready || checks[provider]?.busy}
        onClick={() => check(provider)}>{checks[provider]?.busy ? 'Checking…' : 'Check connection'}</button>
      {checks[provider]?.text && <p role="status">{checks[provider].text}</p>}
    </fieldset>)}</div>
  </>;
}

function Orders({ onUnauthorized }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [generation, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    request('/admin/orders?' + new URLSearchParams({ status, q: search, page })).then(result => {
      if (active) setData(result);
    }).catch(reason => {
      if (!active) return;
      if (reason.status === 401) onUnauthorized();
      else setError(reason.message);
    });
    return () => { active = false; };
  }, [status, search, page, generation, onUnauthorized]);
  async function update(ref, action) {
    setBusy(ref);
    setError('');
    try {
      const { order } = await request('/admin/orders/' + ref + '/' + action, 'POST');
      setData(previous => previous ? { ...previous, orders: previous.orders.map(row => row.ref === ref ? order : row) } : previous);
    } catch (reason) {
      if (reason.status === 401) onUnauthorized();
      else setError(reason.message);
    } finally { setBusy(''); }
  }
  return <>
    <form className="admin-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(0); }}>
      <Field label="Search by registration, email or reference" type="search" value={query} onChange={event => setQuery(event.target.value)} />
      <label className="admin-field"><span>Payment status</span><select value={status}
        onChange={event => { setStatus(event.target.value); setPage(0); }}>
        <option value="">All statuses</option>
        {['pending', 'processing', 'paid', 'failed', 'cancelled'].map(state => <option key={state} value={state}>{statusFor(state)}</option>)}
      </select></label>
      <button className="button">Search</button>
      <button type="button" className="button button-outline" onClick={() => refresh(value => value + 1)}>Refresh</button>
    </form>
    {error && <p role="alert" className="field-error">{error}</p>}
    {!data && !error && <p role="status">Loading orders…</p>}
    {data?.orders.length === 0 && <p>No matching orders.</p>}
    {!!data?.orders.length && <div className="admin-orders">{data.orders.map(order => <article className="admin-section" key={order.ref}>
      <div className="admin-order-heading"><h3>{order.registration} <small>{order.ref}</small></h3>
        <span className="admin-status">{statusFor(order.status)}</span></div>
      <dl className="admin-order-details">
        <div><dt>Customer</dt><dd>{order.email}</dd></div>
        <div><dt>Package</dt><dd>{order.packageTitle} · {formatPrice(order.amount)}</dd></div>
        <div><dt>Report status</dt><dd>{statusFor(order.fulfilment)}</dd></div>
        <div><dt>Placed</dt><dd>{new Date(order.createdAt).toLocaleString('en-GB')}</dd></div>
      </dl>
      <details><summary>Notifications</summary>
        <ul className="admin-notifications">{order.notifications.map(notice => <li key={notice.key}>
          <strong>{emailLabels[notice.key] ?? notice.key}</strong> · {statusFor(notice.state)} · {notice.attempts} attempts
          {notice.error && <p>{notice.error}</p>}
          {notice.preview && <details><summary>View captured email</summary>
            <p>To {notice.preview.to.join(', ')}</p><p>{notice.preview.subject}</p><pre>{notice.preview.text}</pre>
          </details>}
        </li>)}</ul>
      </details>
      {order.status === 'paid' && order.paymentMode.endsWith('-live') && order.fulfilment !== 'sent'
        && <button className="button" disabled={!!busy} onClick={() => update(order.ref, 'sent')}>Mark report sent</button>}
      {order.notifications.some(notice => notice.error && ['queued', 'needs_review'].includes(notice.state))
        && <button className="button button-outline" disabled={!!busy} onClick={() => update(order.ref, 'retry-email')}>Retry failed emails</button>}
    </article>)}</div>}
    {data && (page > 0 || data.hasMore) && <div className="admin-pagination">
      <button className="button button-outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
      <span>Page {page + 1}</span><button className="button button-outline" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>Next</button>
    </div>}
  </>;
}

function Dashboard({ onUnauthorized }) {
  const [tab, setTab] = useState('Orders');
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const { refresh } = useSite();
  useEffect(() => {
    let active = true;
    request('/admin/settings').then(result => { if (active) setPayload(result); }).catch(reason => {
      if (!active) return;
      if (reason.status === 401) onUnauthorized();
      else setError(reason.message);
    });
    return () => { active = false; };
  }, [onUnauthorized]);
  function change(path, value) {
    setMessage('');
    setPayload(previous => {
      const settings = structuredClone(previous.settings);
      let target = settings;
      for (const key of path.slice(0, -1)) target = target[key];
      target[path.at(-1)] = value;
      return { ...previous, settings };
    });
  }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await request('/admin/settings', 'PUT', payload.settings);
      setPayload(previous => ({ ...previous, settings: result.settings }));
      setMessage('Changes saved.');
      refresh();
    } catch (reason) {
      if (reason.status === 401) onUnauthorized();
      else setError(reason.message);
    } finally { setSaving(false); }
  }
  const props = { settings: payload?.settings, change };
  return <>
    <nav className="admin-tabs" aria-label="Dashboard sections">
      {tabs.map(name => <button className="button button-outline" key={name} aria-current={tab === name ? 'page' : undefined}
        onClick={() => { setTab(name); setMessage(''); }}>{name}</button>)}
    </nav>
    <h2>{tab === 'Orders' ? 'Leads and orders' : tab}</h2>
    {tab === 'Orders' && <Orders onUnauthorized={onUnauthorized} />}
    {tab !== 'Orders' && !payload && !error && <p role="status">Loading settings…</p>}
    {tab !== 'Orders' && payload && <form onSubmit={save}>
      <fieldset className="admin-editor" disabled={saving} key={payload.settings.revision}>
        {tab === 'Packages' && <PackageFields {...props} />}
        {tab === 'Content' && <ContentFields {...props} />}
        {tab === 'SEO' && <SeoFields {...props} />}
        {tab === 'Payments' && <PaymentFields {...props} gateways={payload.gateways} mailMode={payload.mailMode} />}
        <button className="button">{saving ? 'Saving…' : 'Save changes'}</button>
      </fieldset>
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </>;
}

export default function Admin() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const unauthorized = React.useCallback(() => setSession({ configured: true, authenticated: false }), []);
  useEffect(() => {
    if (staticDemo) return;
    request('/admin/session').then(setSession).catch(reason => setError(reason.message));
  }, []);
  async function login(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request('/admin/login', 'POST', { email: data.get('email'), password: data.get('password') });
      setSession({ configured: true, authenticated: true });
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    try { await request('/admin/logout', 'POST'); unauthorized(); }
    catch (reason) { setError(reason.message); }
  }
  return <main id="main" className="shell admin-page">
    <header className="admin-heading"><div>
      <span className="eyebrow">CARVEXO</span>
      <h1>{session?.authenticated ? 'Admin dashboard' : 'Admin sign-in'}</h1>
    </div><div className="admin-actions">
      <Link className="button button-outline" to="/">View website</Link>
      {session?.authenticated && <button className="button button-outline" onClick={logout}>Sign out</button>}
    </div></header>
    {staticDemo ? <p>The admin dashboard is available on the full-stack deployment.</p>
      : session?.authenticated ? <Dashboard onUnauthorized={unauthorized} />
        : session?.configured ? <form className="admin-login admin-section" onSubmit={login}>
          <Field label="Admin email" name="email" type="email" autoComplete="username" required />
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          <button className="button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
          : session ? <p>Admin access has not been configured on this deployment.</p>
            : !error && <p role="status">Checking admin access…</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </main>;
}
