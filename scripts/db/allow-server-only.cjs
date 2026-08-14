// Preloaded (`ts-node -r`) by the one db script whose import chain crosses a module
// marked `import 'server-only'` (src/lib/gemini.ts, via mentionBackfill). That marker
// exists to keep Next from bundling server code into a client component; a ts-node
// process IS server code, but plain Node resolves the package to its throwing entry
// because it does not declare the `react-server` condition. Redirect that ONE bare
// specifier to a no-op — nothing else is remapped, and the guard keeps doing its job
// everywhere Next builds.
const Module = require('module');
const path = require('path');

const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return path.join(__dirname, 'server-only-noop.cjs');
  return orig.apply(this, [request, ...rest]);
};
