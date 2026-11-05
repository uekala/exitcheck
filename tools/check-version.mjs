import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const source = readFileSync('src/config.js', 'utf8');
const match = source.match(/\bversion:\s*['"]([^'"]+)['"]/);

if (!match) {
  throw new Error('src/config.js does not define APP.version');
}

const packageVersion = pkg.version;
const appVersion = match[1];
const valid = /^\d+\.\d+\.\d+$/;

if (!valid.test(packageVersion)) {
  throw new Error('package.json has an invalid version: ' + packageVersion);
}
if (!valid.test(appVersion)) {
  throw new Error('src/config.js has an invalid APP.version: ' + appVersion);
}
if (packageVersion !== appVersion) {
  throw new Error(
    'Version mismatch: package.json is ' + packageVersion +
    ', src/config.js is ' + appVersion
  );
}

const ref = process.env.GITHUB_REF || '';
if (ref.startsWith('refs/tags/')) {
  const tagVersion = ref.slice('refs/tags/'.length).replace(/^v/, '');
  if (tagVersion !== packageVersion) {
    throw new Error('Tag ' + ref + ' does not match app version ' + packageVersion);
  }
}

console.log('Exitcheck version ' + packageVersion + ': package, app and tag are consistent.');
