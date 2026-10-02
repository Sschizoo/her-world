'use strict';
const fs = require('node:fs');
const path = require('node:path');

function localName(url) {
  const match = /^\.\/([A-Za-z0-9_.-]+)(?:\?[^"\s]*)?$/.exec(url);
  if (!match || match[1] === '.' || match[1] === '..') throw new Error(`Only same-directory production assets are supported: ${url}`);
  return match[1];
}

function inspectSources(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)].map(match => localName(match[1]));
  const styles = [...html.matchAll(/<link\b(?=[^>]*rel="stylesheet")(?=[^>]*href="([^"]+)")[^>]*>/g)].map(match => localName(match[1]));
  if (!scripts.length || scripts.at(-1) !== 'app.js' || scripts.filter(name => name === 'app.js').length !== 1 || scripts.filter(name => name === 'world.js').length !== 1 || new Set(scripts).size !== scripts.length) throw new Error('Expected unique production modules, world.js, and app.js last');
  return { html, scripts, styles, files: [...new Set(['index.html', ...styles, ...scripts])] };
}

module.exports = { inspectSources, localName };
