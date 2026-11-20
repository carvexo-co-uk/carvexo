import { hashPassword } from '../server/admin-auth.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
if (password.length < 14 || password.length > 256) {
  console.error('Choose an admin password between 14 and 256 characters.');
  process.exitCode = 1;
} else {
  console.log(await hashPassword(password));
}
