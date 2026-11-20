import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Check, CircleAlert, FileText, LockKeyhole, Mail } from 'lucide-react';
import { formatPrice, packages, registrationFrom } from '../../shared/catalog.js';
import { beginOnlinePayment, choosePackage, createPending, currentOrder, newAttempt, paymentReturn, readSession, saveSession, staticDemo } from './api.js';
import { useSite } from './main.jsx';

function Steps({ step }) {
  const items = [['Registration', '/#registration'], ['Report options', '/pricing'], ['Checkout', '/checkout']];
  return <nav className="purchase-steps" aria-label="Order steps">
    <ol>{items.map(([name, path], i) => <li key={name} className={i === step ? 'step-current' : ''}>
      {i < step ? <Link to={path}>{name}</Link>
        : <span aria-current={i === step ? 'step' : undefined}>{name}</span>}
    </li>)}</ol>
  </nav>;
}

function EmptyOrder({ checkout = false }) {
  return <main id="main" className="shell purchase-page">
    <Steps step={checkout ? 2 : 1} />
    <h1>Start with a registration.</h1>
    <p className="purchase-lead">Enter the number from the vehicle’s UK registration plate to see report options.</p>
    <Link className="button" to="/#registration">Enter registration</Link>
  </main>;
}

export function Pricing() {
  const navigate = useNavigate();
  const { config } = useSite();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [showSplash, setShowSplash] = useState(() => navigationType === 'PUSH' && location.state?.registrationSplash === true);
  const heading = useRef(null);
  const enteredThroughSplash = useRef(showSplash);
  useEffect(() => {
    if (!showSplash) {
      if (enteredThroughSplash.current) heading.current?.focus({ preventScroll: true });
      return;
    }
    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, [showSplash]);
  const session = readSession();
  const registration = registrationFrom(session.registration);
  if (!registration) return <EmptyOrder />;
  if (showSplash) return <main id="main" className="pricing-splash">
    <div role="status">
      <img src="/brand/icon.png" width="76" height="76" alt="Carvexo" />
      <p>Preparing your report options</p>
      <span className="splash-progress" aria-hidden="true" />
    </div>
  </main>;
  const options = config?.packages ?? packages;
  const available = !!config && config.mode !== 'closed';
  return <main id="main" className="shell purchase-page pricing-page">
    <Steps step={1} />
    <div className="purchase-heading">
      <div><span className="eyebrow">Vehicle history reports</span>
        <h1 ref={heading} tabIndex={-1}>Choose your report.</h1>
        <p className="purchase-lead">One-off payment. Your report is delivered by email.</p></div>
      <div className="registration-chip">
        <span className="mono">Registration</span>
        <strong>{registration.display}</strong>
        <Link to="/#registration">Edit</Link>
      </div>
    </div>
    <div className="package-grid">{options.map((option) => (
      <article className={'package-card package-' + option.key} key={option.key} aria-label={option.title + ' package'}>
        <FileText className="package-icon" strokeWidth={1.35} size={27} aria-hidden="true" />
        <div><h2>{option.title}</h2><p className="amount">{formatPrice(option.amount)}</p></div>
        {option.description && <p className="package-note">{option.description}</p>}
        {option.features.length > 0
          ? <ul>{option.features.map((feature) => <li key={feature}><Check size={18} aria-hidden="true" /> {feature}</li>)}</ul>
          : <p className="package-note">Report contents will be confirmed before live orders open.</p>}
        {!!option.excluded?.length && <details className="package-excluded"><summary>Checks not included</summary>
          <ul>{option.excluded.map(feature => <li key={feature}>{feature}</li>)}</ul>
        </details>}
        <button disabled={!available} className={'button '  + (option.key === 'basic' ? 'button-outline' : '')}
          aria-label={'Buy ' + option.title + ' for ' + formatPrice(option.amount)}
          onClick={() => { choosePackage(option.key); navigate('/checkout'); }}>
          Buy <span>{formatPrice(option.amount)}</span>
        </button>
      </article>
    ))}</div>
    {config?.mode === 'demo' && <p className="pricing-disclosure"><CircleAlert size={17} /> Demo checkout · Cash on Delivery</p>}
    {config?.mode === 'closed' && <p role="status">Checkout is temporarily closed.</p>}
    {config && !options.length && <p role="status">No packages are currently available.</p>}
  </main>;
}

function OrderSummary({ option, registration, turnaround }) {
  return <aside className="order-summary" aria-labelledby="summary-title">
    <h2 id="summary-title">Order summary</h2>
    <dl>
      <div><dt>Vehicle registration</dt><dd className="summary-registration">{registration}</dd></div>
      <div><dt>Report package</dt><dd>{option.title}</dd></div>
      <div><dt>Delivery</dt><dd>By email</dd></div>
      {turnaround && <div><dt>Expected delivery</dt><dd>{turnaround}</dd></div>}
    </dl>
    <div className="summary-total"><span>Total</span><strong>{formatPrice(option.amount)}</strong></div>
  </aside>;
}

export function EmailField({ email, onChange, disabled }) {
  return <div className="form-field">
    <label htmlFor="order-email">Email address</label>
    <div className="email-input"><Mail size={18} aria-hidden="true" />
      <input id="order-email" type="email" name="email" autoComplete="email" maxLength={254}
        required placeholder="you@example.com" value={email} disabled={disabled} onChange={onChange} /></div>
    <small>We’ll send your confirmation and report to this address.</small>
  </div>;
}

function PaymentTerms({ demo }) {
  return <p className="payment-terms">
    <LockKeyhole size={15} aria-hidden="true" /><span>{demo ? 'Demo order.' : 'One-off payment.'} <Link to="/terms">Terms</Link>, <Link to="/refunds">refunds</Link> and <Link to="/privacy">privacy</Link>.</span>
  </p>;
}

function CheckoutForm({ mode, amount }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const demo = mode === 'demo';
  const provider = mode.startsWith('paypal') ? 'PayPal' : 'Stripe';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await createPending(email.trim(), amount);
      if (demo) return navigate('/confirmation', { replace: true });
      const payment = await beginOnlinePayment();
      if (payment.url) {
        saveSession({ returningFromPayment: true });
        return window.location.assign(payment.url);
      }
      navigate('/confirmation', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return <form className="payment-form" onSubmit={submit}>
    {(demo || mode.endsWith('-test')) && <div className="test-notice"><CircleAlert size={18} aria-hidden="true" />
      <div><strong>{demo ? 'Cash on Delivery (demo)' : provider + ' sandbox'}</strong>
        <p>{demo ? 'Your order is recorded with payment pending. No payment is collected and no report is dispatched.'
          : 'Use a sandbox payment account or test card.'}</p></div>
    </div>}
    <EmailField email={email} disabled={busy} onChange={(event) => setEmail(event.target.value)} />
    {error && <p className="field-error form-error" role="alert">{error}</p>}
    <RestartCheckout />
    <button className="button checkout-pay" disabled={busy}>{busy ? 'Processing…' : demo ? 'Place order' : 'Proceed to payment'}</button>
    <PaymentTerms demo={demo} />
  </form>;
}

export function RestartCheckout() {
  const { packageKey, ref } = readSession();
  if (!ref) return null;
  return <p className="subtle">To use another email address, <Link to="/pricing"
    onClick={() => newAttempt(packageKey)}>start a new checkout</Link>.</p>;
}

export function Checkout() {
  const session = readSession();
  const registration = registrationFrom(session.registration);
  const { config, configError, refresh } = useSite();
  const packageOption = (config?.packages ?? packages).find(option => option.key === session.packageKey);
  if (!registration) return <EmptyOrder checkout />;
  if (!packageOption || !session.attemptId) return <main id="main" className="shell purchase-page">
    <Steps step={2} /><h1>Choose a report first.</h1>
    <Link className="button" to="/pricing">View report options</Link>
  </main>;
  return <main id="main" className="shell purchase-page">
    <Steps step={2} />
    <div className="checkout-heading">
      <span className="eyebrow">Carvexo checkout</span>
      <h1>Complete your order.</h1>
      <p className="purchase-lead">Enter the email address where you’d like to receive the report.</p>
    </div>
    <div className="checkout-layout">
      <div className="checkout-panel">
        {configError ? <div role="alert"><p>{configError}</p><button className="button" onClick={refresh}>Retry checkout</button></div>
          : !config ? <p role="status">Loading checkout…</p>
            : config.mode === 'closed' ? <p role="status">Checkout is temporarily closed.</p>
              : <CheckoutForm mode={config.mode} amount={packageOption.amount} />}
      </div>
      <OrderSummary option={packageOption} registration={registration.display} turnaround={config?.turnaround} />
    </div>
  </main>;
}

export function Confirmation() {
  const [order, setOrder] = useState(null);
  const [state, setState] = useState('checking');
  const [check, setCheck] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer;
    let attempts = 0;
    async function poll() {
      try {
        if (readSession().returningFromPayment) {
          await paymentReturn(new URLSearchParams(location.search).get('cancelled') === '1');
          saveSession({ returningFromPayment: false });
          if (location.search) history.replaceState(history.state, '', '/confirmation');
        }
        const item = await currentOrder();
        if (cancelled) return;
        setOrder(item);
        if (!item) return setState('missing');
        if (item.mode === 'demo' && item.status === 'pending') {
          saveSession({ complete: true });
          return setState('confirmed');
        }
        if (item.status === 'paid') {
          saveSession({ complete: true });
          return setState('paid');
        }
        if (['failed', 'cancelled'].includes(item.status)) return setState(item.status);
        if (++attempts >= 30) return setState('waiting');
      } catch {
        if (cancelled) return;
        if (++attempts >= 4) return setState('error');
      }
      timer = setTimeout(poll, 2000);
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [check]);
  const confirmed = ['paid', 'confirmed'].includes(state);
  const text = {
    checking: ['Checking payment status…', 'Waiting for confirmation from the payment service.'],
    waiting: ['Payment is still processing.', 'Check again before placing another order.'],
    failed: ['Payment didn’t go through.', 'You can return to checkout and try another card.'],
    error: ['Payment status is unavailable.', 'Check again before placing another order.'],
    missing: ['No order found in this session.', 'Use the confirmation email to find your order reference, or contact support.'],
    cancelled: ['Checkout cancelled.', 'Your order is saved. You can return to checkout to try again.'],
    confirmed: ['Order confirmed', staticDemo
      ? 'This preview stores the order in this browser. It does not send an email.'
      : 'Your Cash on Delivery demo order is recorded. No payment is due and no report will be dispatched.'],
    paid: order?.mode.endsWith('-test')
      ? ['Sandbox payment confirmed.', 'Your test order is saved. No report will be dispatched.']
      : ['Payment confirmed.', 'The CARVEXO team will prepare your report and email it to you.'],
  }[state];
  return <main id="main" className="shell purchase-page confirmation-page">
    <div className="confirmation-panel" aria-live="polite">
      <span className={'confirmation-icon' + (confirmed ? ' is-paid' : '')}>
        {confirmed ? <Check size={28} aria-hidden="true" /> : <FileText size={27} aria-hidden="true" />}
      </span>
      <span className="eyebrow">Order status</span>
      <h1>{text[0]}</h1><p className="purchase-lead">{text[1]}</p>
      {order && <dl className="confirmation-details">
        <div><dt>Order reference</dt><dd className="mono">{order.ref}</dd></div>
        <div><dt>Registration</dt><dd>{order.registration}</dd></div>
        <div><dt>Report</dt><dd>{order.packageTitle}</dd></div>
        <div><dt>Total</dt><dd>{formatPrice(order.amount)}</dd></div>
        <div><dt>Email</dt><dd>{order.emailHint}</dd></div>
        <div><dt>Payment status</dt><dd>{order.status[0].toUpperCase() + order.status.slice(1)}</dd></div>
      </dl>}
      <div className="support-actions">
        {['waiting', 'error'].includes(state) && <button className="button" onClick={() => {
          setState('checking');
          setCheck(check + 1);
        }}>Check status</button>}
        {['failed', 'cancelled'].includes(state) && <Link className="button" to="/checkout">Try payment again</Link>}
        {['paid', 'confirmed', 'missing'].includes(state) && <Link className="button" to="/">Return to Carvexo</Link>}
        {state !== 'checking' && <Link to="/contact" className="button button-outline">Contact support</Link>}
      </div>
    </div>
  </main>;
}
