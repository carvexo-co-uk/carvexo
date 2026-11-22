# Carvexo

Carvexo is a registration-first UK vehicle history report website. The site accepts an order and confirms payment. The Carvexo team prepares and emails each report manually.

## Local demo

Use Node.js 22.12 or later.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open the Vite URL. Both report packages can be ordered through Cash on Delivery (demo). Orders remain pending and no payment or report is dispatched. Use fictional test details. Local orders and email captures go to `.data/orders.json` and `.data/mail/`. The owner can also read captured email previews in the admin order record.

Set `CARVEXO_ADMIN_EMAIL`, `CARVEXO_ADMIN_PASSWORD_HASH`, and a randomly generated `CARVEXO_ADMIN_SESSION_SECRET` of at least 32 characters to enable `/admin`. In Bash, generate the password hash without placing your password in shell history:

```sh
read -rs -p 'Admin password: ' carvexo_admin_password
printf '\n'
printf '%s' "$carvexo_admin_password" | node scripts/admin-password.mjs
unset carvexo_admin_password
```

`npm test` exercises checkout, duplicate submissions, admin access and edits, notifications, and mocked provider behavior. Set `CARVEXO_TEST_MONGODB_URI` to a disposable test database to run the optional MongoDB integration check. `npm run build && npm start` serves the full-stack production build locally. `npm run build:preview` builds the separate browser-only design preview for the existing Sites project.

## Admin and emails

### Local PayPal Sandbox demo

Use a PayPal Sandbox REST app and a separate Sandbox personal buyer account. In the local `.env`, set `CARVEXO_PUBLIC_ORIGIN` to the exact browser origin printed by Vite, normally `http://localhost:5173`. Set `PAYPAL_ENVIRONMENT=sandbox`, the sandbox app's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, and optionally `PAYPAL_BRAND_NAME="Apex Design"`. Leave `PAYPAL_WEBHOOK_ID` empty. If you configure `PAYPAL_MERCHANT_ID`, use the sandbox seller's ID. Keep `CARVEXO_MAIL_MODE=capture` to preview emails locally.

Restart the dev server, open `/admin`, and go to Payments → PayPal → Check connection. Select PayPal and save. Start a new checkout and sign in with the sandbox buyer. Complete the checkout and return to the local site in the same browser to let the server capture and verify the sandbox payment. This path requires a browser return, so it does not demonstrate asynchronous webhook settlement. [PayPal Sandbox accounts](https://developer.paypal.com/tools/sandbox/accounts/)

Use `/admin` to search leads and orders, view notification attempts, retry failed emails, and mark verified live reports sent after emailing the report manually. Edit the public content, SEO, packages, contact and notification settings from the corresponding tabs. Package prices and features are saved with each order.

Owner notifications and customer Reply-To default to `carvexo.co.uk@gmail.com`. For real inbox delivery, set `CARVEXO_MAIL_MODE=resend`, `RESEND_API_KEY` and `CARVEXO_MAIL_FROM` with a sender authorized by Resend. Demo and live checkouts can both send emails when that transport is configured. Test one demo order with an authorized test buyer before presenting it to the client. Capture mode stores preview messages instead. [Sender setup](https://resend.com/docs/send-with-nodejs)

## Vercel deployment

1. Import this repository into a Vercel project. The repository's Vite build and Node API share one origin. Use the build and routing configuration in `vercel.json`.
2. Set `MONGODB_URI` to the Carvexo Atlas database and configure its access from Vercel. Vercel requires durable storage. Set the admin credentials above, and set `CRON_SECRET` so the daily Vercel job can drain due notifications. Checkout and webhook requests also start the order's notification processing.
3. Add `carvexo.co.uk` to the Vercel project, apply the DNS records Vercel supplies in Hostinger, then set `CARVEXO_PUBLIC_ORIGIN=https://carvexo.co.uk` after HTTPS is ready. Use the exact primary origin for provider callbacks.
4. Demo checkout is enabled on first run. Add approved business and support details, policy text and delivery wording in admin before accepting real orders. Indexing is opt-in with `CARVEXO_ALLOW_INDEXING=true` on a live-ready deployment.
5. Configure each payment integration server-side. Use unique sandbox and live deployments or databases. Select the provider through Admin → Payments after its connection check succeeds. Use the provider's test instruments before enabling live checkout.
   - **Stripe** uses `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`. Configure `/api/webhooks/stripe` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`. Existing PaymentIntent webhooks remain supported for legacy orders. [Stripe webhook setup](https://docs.stripe.com/checkout/fulfillment)
   - **PayPal** uses `PAYPAL_ENVIRONMENT` (`sandbox` or `live`), `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID` from the same REST app and environment. Configure `/api/webhooks/paypal` for `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING` and `PAYMENT.CAPTURE.DENIED`. [PayPal webhook setup](https://developer.paypal.com/payment-methods/webhooks/)
   - Set `PAYPAL_MERCHANT_ID` to the intended account's PayPal Merchant ID to verify the recipient of each order. Use the sandbox seller's ID on the sandbox deployment and the approved business profile's ID on production. Set `PAYPAL_BRAND_NAME` to request a buyer-facing checkout label, such as `Apex Design`. PayPal account and statement details are managed in PayPal.
6. Once real merchant setup, webhook delivery, and the authorized sender are verified, set `CARVEXO_PRODUCTION_APPROVED=true`. Live checkout also needs the Atlas URI, HTTPS origin, and Resend transport. Use Admin → Payments to select the provider, and disable the Cash on Delivery demo as appropriate. The optional `CARVEXO_TAWK_WIDGET` flag accepts the existing Tawk.to `propertyId/widgetId`.

## Car model and fallback

The studio uses [BMW M4 Competition M Package](https://sketchfab.com/3d-models/bmw-m4-competition-m-package-5c0a2dafb1ad408d9fc9eeef9aee531b) by [SRT Performance](https://sketchfab.com/TheRealSRT), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). This adaptation changes the paint, scale, orientation, mesh groups and animation pivots. The matching fallback frames were rendered from that adaptation.

The Three.js renderer expects front hinge groups `DoorLeft` and `DoorRight`, plus the four independent wheel groups `WheelFL`, `WheelFR`, `WheelRL` and `WheelRR` on local Z axles. The negative X axis points toward the nose and positive Y points up. The scene uses the `Alloy_Paint`, `Smoked_Glass` and `Headlamp_Emitter` materials for the inspection and lighting effects.

```sh
blender -b -t 12 -P scripts/prepare-bmw.py -- /absolute/path/to/bmw-source.glb /tmp/carvexo-bmw
npx --yes @gltf-transform/cli meshopt /tmp/carvexo-bmw/bmw-m4.glb client/public/scene/bmw-m4.glb --level medium
for frame in coverage inspection; do
  ffmpeg -y -i "/tmp/carvexo-bmw/$frame.png" -vf 'nlmeans=s=2.3:p=5:r=9' -quality 88 "client/public/scene/$frame.webp"
done
```

A single live BMW GLB is used from the homepage hero through the drive. Scroll-selected speed controls its straight-line position, wheel rotation and road movement. The tracking camera follows the same path at a fixed height and angle. Scroll through Report coverage to separate and reassemble the BMW, then through Sample report to turn it once. Both sequences reverse with the scroll. The poster and wheel atlas cover loading and non-WebGL browsers. Regenerate those assets with:

```sh
blender -b -t 8 -P scripts/prepare-bmw.py -- /absolute/path/to/bmw-source.glb /tmp/carvexo-motion --motion
mkdir -p /tmp/carvexo-motion-clean
ffmpeg -framerate 24 -i /tmp/carvexo-motion/wheels-%04d.png -vf 'nlmeans=s=2.4:p=5:r=9' -start_number 0 /tmp/carvexo-motion-clean/wheels-%04d.png
python scripts/encode-bmw-wheels.py /tmp/carvexo-motion-clean client/public/scene
```

The same timeline supplies 2D animation frames for browsers without WebGL:

```sh
node scripts/bmw-showcase-frames.mjs /tmp/carvexo-showcase.json
blender -b -t 8 -P scripts/prepare-bmw.py -- /absolute/path/to/bmw-source.glb /tmp/carvexo-showcase --showcase /tmp/carvexo-showcase.json
for shot in coverage inspection; do
  ffmpeg -start_number 0 -framerate 24 -i "/tmp/carvexo-showcase/$shot-%04d.png" -vf 'nlmeans=s=3.2:p=5:r=11,tile=5x4' -frames:v 1 -c:v libwebp -quality 83 "client/public/scene/bmw-showcase-$shot.webp"
done
```

System and website reduced-motion settings provide a stable scene. Sound defaults to On, starts when the browser allows audio after interaction, and remembers the visitor’s setting. Studio audio is synthesised locally.

## References

- Animation direction based on vehicle staging, scroll chapters and exploded inspection in [ThreeUI Vanta](https://threeui.com/landing-pages/vanta-motorcycle-landing-page).
- Report content structure based on the public [VINReport](https://vinreport.com/), [illustrative report reference](https://vinreport.com/report/sample) and [Get Vin Info](https://www.getvininfo.co.uk/). Carvexo’s copy, artwork, fixtures and pricing are independent.
