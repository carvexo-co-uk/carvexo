import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'vite';

process.env.VITE_STATIC_DEMO = 'true';
await build();
for (const route of ['pricing', 'checkout', 'confirmation', 'about', 'contact', 'privacy', 'terms', 'refunds']) {
  await mkdir(new URL(`../dist/${route}/`, import.meta.url), { recursive: true });
  await copyFile(
    new URL('../dist/index.html', import.meta.url),
    new URL(`../dist/${route}/index.html`, import.meta.url),
  );
}
await copyFile(new URL('../dist/index.html', import.meta.url), new URL('../dist/404.html', import.meta.url));
