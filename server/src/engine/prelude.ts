// JavaScript prelude evaluated inside the QuickJS sandbox before user scripts.
// Implements a Postman-compatible `pm` API, a chai-like `expect`, console, and
// small shims for commonly `require`d modules. Must not use backticks.
export const PRELUDE = String.raw`
(function (global) {
  'use strict';
  var ctx = global.__ctx;            // input context from host (JSON)
  var host = global.__host;          // host functions
  var out = { tests: [], console: [], vars: { globals: {}, collection: {}, environment: {}, local: {} }, nextRequest: undefined, request: null, skip: false };
  global.__out = function () { out.request = serializeRequest(); return out; };

  // ---------- console ----------
  function fmt(a) {
    if (a === undefined) return 'undefined';
    if (a === null) return null;
    if (a instanceof Error) return (a.name || 'Error') + ': ' + a.message;
    if (typeof a === 'function') return '[Function ' + (a.name || 'anonymous') + ']';
    if (typeof a === 'object') { try { return JSON.parse(JSON.stringify(a)); } catch (e) { return String(a); } }
    return a;
  }
  var console = {};
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (lvl) {
    console[lvl] = function () { out.console.push({ level: lvl, args: Array.prototype.slice.call(arguments).map(fmt), ts: host.now() }); };
  });
  console.table = console.log; console.dir = console.log; console.trace = console.log;
  global.console = console;

  // ---------- variable scopes ----------
  function scope(name, store) {
    var mutations = out.vars[name];
    return {
      get: function (k) { if (Object.prototype.hasOwnProperty.call(mutations, k)) return mutations[k] === null ? undefined : mutations[k]; return store[k]; },
      set: function (k, v) { v = v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v); mutations[k] = v; store[k] = v; },
      unset: function (k) { mutations[k] = null; delete store[k]; },
      has: function (k) { return this.get(k) !== undefined; },
      clear: function () { for (var k in store) { mutations[k] = null; } for (var k2 in store) delete store[k2]; },
      toObject: function () { var o = {}; for (var k in store) o[k] = store[k]; return o; },
      replaceIn: function (s) { return replaceIn(s); },
      name: name
    };
  }
  var globals = scope('globals', ctx.scopes.globals);
  var collectionVariables = scope('collection', ctx.scopes.collection);
  var environment = scope('environment', ctx.scopes.environment);
  var locals = scope('local', ctx.scopes.local);
  environment.name = ctx.environmentName || '';
  var iterationData = {
    get: function (k) { return ctx.scopes.data ? ctx.scopes.data[k] : undefined; },
    toObject: function () { return ctx.scopes.data || {}; },
    has: function (k) { return !!ctx.scopes.data && Object.prototype.hasOwnProperty.call(ctx.scopes.data, k); },
    toJSON: function () { return ctx.scopes.data || {}; }
  };
  function lookup(k) {
    if (k.charAt(0) === '$') return host.dynamicVar(k);
    var v;
    v = locals.get(k); if (v !== undefined) return v;
    if (ctx.scopes.data && Object.prototype.hasOwnProperty.call(ctx.scopes.data, k)) { v = ctx.scopes.data[k]; return typeof v === 'string' ? v : JSON.stringify(v); }
    v = environment.get(k); if (v !== undefined) return v;
    v = collectionVariables.get(k); if (v !== undefined) return v;
    v = globals.get(k); if (v !== undefined) return v;
    return undefined;
  }
  function replaceIn(s, depth) {
    depth = depth || 0;
    if (typeof s !== 'string' || s.indexOf('{{') < 0) return s;
    return s.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, function (m, name) { var v = lookup(name); if (v === undefined) return m; return depth < 5 ? replaceIn(v, depth + 1) : v; });
  }
  var variables = {
    get: function (k) { return lookup(k); },
    set: function (k, v) { locals.set(k, v); },
    unset: function (k) { locals.unset(k); },
    has: function (k) { return lookup(k) !== undefined; },
    replaceIn: replaceIn,
    toObject: function () { var o = {}; [globals, collectionVariables, environment, locals].forEach(function (s) { var t = s.toObject(); for (var k in t) o[k] = t[k]; }); return o; }
  };

  // ---------- headers / url / request ----------
  function HeaderList(init) {
    this._items = [];
    var self = this;
    (init || []).forEach(function (h) { self._items.push({ key: h.key, value: h.value }); });
  }
  HeaderList.prototype.add = function (h) { this._items.push({ key: h.key, value: String(h.value) }); };
  HeaderList.prototype.upsert = function (h) { var i = this._idx(h.key); if (i >= 0) this._items[i].value = String(h.value); else this.add(h); };
  HeaderList.prototype.remove = function (k) { var self = this; this._items = this._items.filter(function (h) { return h.key.toLowerCase() !== String(k).toLowerCase(); }); };
  HeaderList.prototype.get = function (k) { var i = this._idx(k); return i >= 0 ? this._items[i].value : undefined; };
  HeaderList.prototype.has = function (k, v) { var i = this._idx(k); return i >= 0 && (v === undefined || this._items[i].value === v); };
  HeaderList.prototype.each = function (fn) { this._items.forEach(fn); };
  HeaderList.prototype.all = function () { return this._items.slice(); };
  HeaderList.prototype.count = function () { return this._items.length; };
  HeaderList.prototype.toObject = function () { var o = {}; this._items.forEach(function (h) { o[h.key] = h.value; }); return o; };
  HeaderList.prototype.toJSON = HeaderList.prototype.all;
  HeaderList.prototype._idx = function (k) { k = String(k).toLowerCase(); for (var i = 0; i < this._items.length; i++) if (this._items[i].key.toLowerCase() === k) return i; return -1; };

  function Url(str) { this._str = str || ''; var self = this;
    this.query = {
      add: function (q) { self._str += (self._str.indexOf('?') >= 0 ? '&' : '?') + encodeURIComponent(q.key) + '=' + encodeURIComponent(q.value); },
      remove: function (k) { var p = self._str.split('?'); if (p.length < 2) return; var parts = p[1].split('&').filter(function (kv) { return decodeURIComponent(kv.split('=')[0]) !== k; }); self._str = p[0] + (parts.length ? '?' + parts.join('&') : ''); },
      toObject: function () { var o = {}; var p = self._str.split('?'); if (p.length < 2) return o; p[1].split('&').forEach(function (kv) { var i = kv.indexOf('='); o[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1)); }); return o; },
      get: function (k) { return this.toObject()[k]; },
      has: function (k) { return Object.prototype.hasOwnProperty.call(this.toObject(), k); },
      all: function () { var o = this.toObject(); return Object.keys(o).map(function (k) { return { key: k, value: o[k] }; }); }
    };
  }
  Url.prototype.toString = function () { return this._str; };
  Url.prototype.update = function (s) { this._str = String(s); };
  Url.prototype.getHost = function () { try { return this._str.replace(/^[a-z]+:\/\//i, '').split(/[\/?#]/)[0]; } catch (e) { return ''; } };
  Url.prototype.getPath = function () { var m = this._str.match(/^[a-z]+:\/\/[^\/]+(\/[^?#]*)?/i); return m && m[1] ? m[1] : '/'; };
  Object.defineProperty(Url.prototype, 'host', { get: function () { return this.getHost().split('.'); } });
  Object.defineProperty(Url.prototype, 'path', { get: function () { return this.getPath().split('/').filter(Boolean); } });
  Object.defineProperty(Url.prototype, 'protocol', { get: function () { var m = this._str.match(/^([a-z]+):/i); return m ? m[1] : 'http'; } });

  var req = ctx.request || { method: 'GET', url: '', headers: [], body: null };
  var request = {
    id: ctx.info && ctx.info.requestId,
    name: ctx.info && ctx.info.requestName,
    method: req.method,
    url: new Url(req.url),
    headers: new HeaderList(req.headers),
    body: req.body,
    auth: req.auth,
    addHeader: function (h) { this.headers.add(h); },
    removeHeader: function (k) { this.headers.remove(k); },
    upsertHeader: function (h) { this.headers.upsert(h); },
    addQueryParams: function (q) { var self = this; (Array.isArray(q) ? q : [q]).forEach(function (p) { if (typeof p === 'string') { var i = p.indexOf('='); self.url.query.add({ key: i < 0 ? p : p.slice(0, i), value: i < 0 ? '' : p.slice(i + 1) }); } else self.url.query.add(p); }); },
    removeQueryParams: function (k) { var self = this; (Array.isArray(k) ? k : [k]).forEach(function (x) { self.url.query.remove(typeof x === 'string' ? x : x.key); }); },
    toJSON: function () { return serializeRequest(); }
  };
  function serializeRequest() { return { method: request.method, url: request.url.toString(), headers: request.headers.toObject(), body: request.body }; }

  // ---------- response ----------
  var response = null;
  if (ctx.response) {
    var r = ctx.response;
    var hdrs = new HeaderList(r.headers.map(function (h) { return { key: h[0], value: h[1] }; }));
    var jsonCache;
    response = {
      code: r.status, status: r.statusText, responseTime: r.timeMs, responseSize: r.size, headers: hdrs,
      cookies: new HeaderList((r.cookies || []).map(function (c) { return { key: c.name, value: c.value }; })),
      text: function () { return r.isBase64 ? host.base64decode(r.body) : r.body; },
      json: function () { if (jsonCache === undefined) { try { jsonCache = JSON.parse(this.text()); } catch (e) { throw new Error('Response body is not valid JSON: ' + e.message); } } return jsonCache; },
      stream: r.body,
      reason: function () { return r.statusText; },
      dataURI: function () { return 'data:' + (r.contentType || 'text/plain') + ';base64,' + (r.isBase64 ? r.body : host.base64encode(r.body)); },
      toJSON: function () { return { code: r.status, status: r.statusText, headers: hdrs.toObject(), body: this.text(), responseTime: r.timeMs }; }
    };
    response.to = responseAssertions(response);
  }

  // ---------- tests ----------
  function test(name, fn) {
    try { var rv = fn(); if (rv && typeof rv.then === 'function') { throw new Error('async tests are not supported; use synchronous assertions'); } out.tests.push({ name: name, passed: true }); }
    catch (e) { out.tests.push({ name: name, passed: false, error: e && e.message ? e.message : String(e) }); }
  }
  test.skip = function (name) { out.tests.push({ name: name, passed: true, skipped: true }); };

  // ---------- expect (chai subset) ----------
  function AssertionError(msg) { this.name = 'AssertionError'; this.message = msg; }
  AssertionError.prototype = Object.create(Error.prototype);
  function inspect(v) { try { if (typeof v === 'string') return JSON.stringify(v); if (v === undefined) return 'undefined'; if (typeof v === 'function') return '[Function]'; var s = JSON.stringify(v); return s && s.length > 200 ? s.slice(0, 200) + '…' : s; } catch (e) { return String(v); } }
  function typeOf(v) { if (v === null) return 'null'; if (Array.isArray(v)) return 'array'; if (v instanceof Date) return 'date'; if (v instanceof RegExp) return 'regexp'; if (v instanceof Error) return 'error'; return typeof v; }
  function deepEq(a, b) {
    if (a === b) return true;
    if (typeOf(a) !== typeOf(b)) return false;
    if (a instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof RegExp) return String(a) === String(b);
    if (typeof a !== 'object' || a === null || b === null) return a !== a && b !== b;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) { if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEq(a[ka[i]], b[ka[i]])) return false; }
    return true;
  }
  function Assertion(obj, flags) { this.obj = obj; this.flags = flags || { not: false, deep: false, any: false, all: false, nested: false, own: false, msg: '' }; }
  var A = Assertion.prototype;
  function chain(name) { Object.defineProperty(A, name, { get: function () { return this; } }); }
  ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'but', 'does', 'still', 'also'].forEach(chain);
  Object.defineProperty(A, 'not', { get: function () { this.flags.not = !this.flags.not; return this; } });
  Object.defineProperty(A, 'deep', { get: function () { this.flags.deep = true; return this; } });
  Object.defineProperty(A, 'nested', { get: function () { this.flags.nested = true; return this; } });
  Object.defineProperty(A, 'own', { get: function () { this.flags.own = true; return this; } });
  Object.defineProperty(A, 'any', { get: function () { this.flags.any = true; this.flags.all = false; return this; } });
  Object.defineProperty(A, 'all', { get: function () { this.flags.all = true; this.flags.any = false; return this; } });
  A.assert = function (cond, msg, negMsg) {
    var ok = this.flags.not ? !cond : cond;
    if (!ok) throw new AssertionError((this.flags.msg ? this.flags.msg + ': ' : '') + (this.flags.not ? negMsg : msg));
    return this;
  };
  A.equal = A.equals = A.eq = function (v, m) { if (m) this.flags.msg = m; if (this.flags.deep) return this.eql(v); return this.assert(this.obj === v, 'expected ' + inspect(this.obj) + ' to equal ' + inspect(v), 'expected ' + inspect(this.obj) + ' to not equal ' + inspect(v)); };
  A.eql = A.eqls = A.deepEqual = function (v, m) { if (m) this.flags.msg = m; return this.assert(deepEq(this.obj, v), 'expected ' + inspect(this.obj) + ' to deeply equal ' + inspect(v), 'expected ' + inspect(this.obj) + ' to not deeply equal ' + inspect(v)); };
  function prop(name, cond) { Object.defineProperty(A, name, { get: function () { return this.assert(cond(this.obj), 'expected ' + inspect(this.obj) + ' to be ' + name, 'expected ' + inspect(this.obj) + ' not to be ' + name); } }); }
  prop('ok', function (v) { return !!v; });
  prop('true', function (v) { return v === true; });
  prop('false', function (v) { return v === false; });
  prop('null', function (v) { return v === null; });
  prop('undefined', function (v) { return v === undefined; });
  prop('NaN', function (v) { return v !== v; });
  prop('exist', function (v) { return v !== null && v !== undefined; });
  prop('empty', function (v) { if (typeof v === 'string' || Array.isArray(v)) return v.length === 0; if (v && typeof v === 'object') return Object.keys(v).length === 0; return !v; });
  prop('finite', function (v) { return typeof v === 'number' && isFinite(v); });
  prop('arguments', function (v) { return Object.prototype.toString.call(v) === '[object Arguments]'; });
  A.a = A.an = function (t, m) { if (m) this.flags.msg = m; var actual = typeOf(this.obj); return this.assert(actual === String(t).toLowerCase(), 'expected ' + inspect(this.obj) + ' to be a ' + t + ' (got ' + actual + ')', 'expected ' + inspect(this.obj) + ' not to be a ' + t); };
  A.above = A.gt = A.greaterThan = function (n, m) { if (m) this.flags.msg = m; var v = sizeOrVal(this); return this.assert(v > n, 'expected ' + inspect(v) + ' to be above ' + n, 'expected ' + inspect(v) + ' to be at most ' + n); };
  A.below = A.lt = A.lessThan = function (n, m) { if (m) this.flags.msg = m; var v = sizeOrVal(this); return this.assert(v < n, 'expected ' + inspect(v) + ' to be below ' + n, 'expected ' + inspect(v) + ' to be at least ' + n); };
  A.least = A.gte = A.greaterThanOrEqual = function (n, m) { if (m) this.flags.msg = m; var v = sizeOrVal(this); return this.assert(v >= n, 'expected ' + inspect(v) + ' to be at least ' + n, 'expected ' + inspect(v) + ' to be below ' + n); };
  A.most = A.lte = A.lessThanOrEqual = function (n, m) { if (m) this.flags.msg = m; var v = sizeOrVal(this); return this.assert(v <= n, 'expected ' + inspect(v) + ' to be at most ' + n, 'expected ' + inspect(v) + ' to be above ' + n); };
  A.within = function (a, b, m) { if (m) this.flags.msg = m; var v = sizeOrVal(this); return this.assert(v >= a && v <= b, 'expected ' + inspect(v) + ' to be within ' + a + '..' + b, 'expected ' + inspect(v) + ' not to be within ' + a + '..' + b); };
  A.closeTo = A.approximately = function (n, d, m) { if (m) this.flags.msg = m; return this.assert(Math.abs(this.obj - n) <= d, 'expected ' + this.obj + ' to be close to ' + n + ' +/- ' + d, 'expected ' + this.obj + ' not to be close to ' + n); };
  function sizeOrVal(self) { return self.flags.doLength ? (self.obj && self.obj.length) : self.obj; }
  Object.defineProperty(A, 'lengthOf', { get: function () { var self = this; var f = function (n, m) { if (m) self.flags.msg = m; var len = self.obj == null ? undefined : (self.obj.length !== undefined ? self.obj.length : self.obj.size); return self.assert(len === n, 'expected ' + inspect(self.obj) + ' to have length ' + n + ' but got ' + len, 'expected ' + inspect(self.obj) + ' not to have length ' + n); }; self.flags.doLength = true; f.above = f.gt = function (n) { return self.above(n); }; f.below = f.lt = function (n) { return self.below(n); }; f.least = f.gte = function (n) { return self.least(n); }; f.most = f.lte = function (n) { return self.most(n); }; f.within = function (a, b) { return self.within(a, b); }; return f; } });
  Object.defineProperty(A, 'length', { get: function () { return this.lengthOf; } });
  var includeFn = function (v, m) {
    if (m) this.flags.msg = m; var o = this.obj; var ok;
    if (typeof o === 'string') ok = o.indexOf(String(v)) >= 0;
    else if (Array.isArray(o)) ok = this.flags.deep ? o.some(function (x) { return deepEq(x, v); }) : o.indexOf(v) >= 0;
    else if (o && typeof o === 'object' && v && typeof v === 'object') { ok = Object.keys(v).every(function (k) { return deepEq(o[k], v[k]); }); }
    else ok = false;
    return this.assert(ok, 'expected ' + inspect(o) + ' to include ' + inspect(v), 'expected ' + inspect(o) + ' to not include ' + inspect(v));
  };
  A.string = function (s, m) { if (m) this.flags.msg = m; return this.assert(typeof this.obj === 'string' && this.obj.indexOf(s) >= 0, 'expected ' + inspect(this.obj) + ' to contain ' + inspect(s), 'expected ' + inspect(this.obj) + ' not to contain ' + inspect(s)); };
  A.match = A.matches = function (re, m) { if (m) this.flags.msg = m; return this.assert(re.test(String(this.obj)), 'expected ' + inspect(this.obj) + ' to match ' + re, 'expected ' + inspect(this.obj) + ' not to match ' + re); };
  A.property = function (name, val, m) {
    if (m) this.flags.msg = m; var o = this.obj; var has, actual;
    if (this.flags.nested) { var parts = String(name).replace(/\[(\d+)\]/g, '.$1').split('.'); var cur = o; has = true; for (var i = 0; i < parts.length; i++) { if (cur == null || !Object.prototype.hasOwnProperty.call(Object(cur), parts[i])) { has = false; break; } cur = cur[parts[i]]; } actual = cur; }
    else { has = o != null && (this.flags.own ? Object.prototype.hasOwnProperty.call(o, name) : name in Object(o)); actual = has ? o[name] : undefined; }
    if (arguments.length >= 2 && val !== undefined || (arguments.length >= 2 && !m)) {
      var eq = this.flags.deep ? deepEq(actual, val) : actual === val;
      this.assert(has && eq, 'expected ' + inspect(o) + ' to have property ' + inspect(name) + ' of ' + inspect(val) + ', but got ' + inspect(actual), 'expected ' + inspect(o) + ' not to have property ' + inspect(name) + ' of ' + inspect(val));
    } else this.assert(has, 'expected ' + inspect(o) + ' to have property ' + inspect(name), 'expected ' + inspect(o) + ' not to have property ' + inspect(name));
    var next = new Assertion(actual, { not: false, deep: this.flags.deep }); return next;
  };
  A.keys = A.key = function () {
    var keys = Array.prototype.slice.call(arguments); if (keys.length === 1 && Array.isArray(keys[0])) keys = keys[0]; if (keys.length === 1 && keys[0] && typeof keys[0] === 'object') keys = Object.keys(keys[0]);
    var actual = this.obj ? Object.keys(this.obj) : []; var ok;
    if (this.flags.any) ok = keys.some(function (k) { return actual.indexOf(k) >= 0; });
    else if (this.flags.contains) ok = keys.every(function (k) { return actual.indexOf(k) >= 0; });
    else ok = keys.every(function (k) { return actual.indexOf(k) >= 0; }) && actual.length === keys.length;
    return this.assert(ok, 'expected ' + inspect(this.obj) + ' to have keys ' + inspect(keys), 'expected ' + inspect(this.obj) + ' not to have keys ' + inspect(keys));
  };
  A.oneOf = function (list, m) { if (m) this.flags.msg = m; var o = this.obj; return this.assert(list.some(function (x) { return deepEq(x, o); }), 'expected ' + inspect(o) + ' to be one of ' + inspect(list), 'expected ' + inspect(o) + ' not to be one of ' + inspect(list)); };
  A.members = function (list, m) { if (m) this.flags.msg = m; var o = this.obj || []; var deep = this.flags.deep; var ok = Array.isArray(o) && list.every(function (x) { return o.some(function (y) { return deep ? deepEq(x, y) : x === y; }); }) && (this.flags.contains || o.length === list.length); return this.assert(ok, 'expected ' + inspect(o) + ' to have members ' + inspect(list), 'expected ' + inspect(o) + ' not to have members ' + inspect(list)); };
  A.instanceOf = A.instanceof = function (c, m) { if (m) this.flags.msg = m; return this.assert(this.obj instanceof c, 'expected ' + inspect(this.obj) + ' to be instance of ' + (c && c.name), 'expected not instance of ' + (c && c.name)); };
  A.satisfy = function (fn, m) { if (m) this.flags.msg = m; return this.assert(!!fn(this.obj), 'expected ' + inspect(this.obj) + ' to satisfy ' + (fn.name || 'function'), 'expected not to satisfy'); };
  A.throw = A.throws = A.Throw = function (errLike, msg) {
    var thrown = null; try { this.obj(); } catch (e) { thrown = e; }
    var ok = !!thrown;
    if (ok && errLike !== undefined) { if (typeof errLike === 'string') ok = String(thrown && thrown.message).indexOf(errLike) >= 0; else if (errLike instanceof RegExp) ok = errLike.test(String(thrown && thrown.message)); else if (typeof errLike === 'function') ok = thrown instanceof errLike; }
    if (ok && typeof msg === 'string') ok = String(thrown && thrown.message).indexOf(msg) >= 0;
    return this.assert(ok, 'expected function to throw' + (errLike ? ' ' + inspect(String(errLike)) : '') + (thrown ? ' but threw ' + inspect(thrown.message) : ' but it did not'), 'expected function not to throw');
  };
  A.respondTo = function (name) { return this.assert(this.obj && typeof this.obj[name] === 'function', 'expected to respond to ' + name, 'expected not to respond to ' + name); };
  A.jsonSchema = function (schema, m) { if (m) this.flags.msg = m; var errs = validateSchema(this.obj, schema, '$'); return this.assert(errs.length === 0, 'expected value to match JSON schema: ' + errs.join('; '), 'expected value not to match JSON schema'); };
  Object.defineProperty(A, 'containing', { get: function () { this.flags.contains = true; return this; } });
  Object.defineProperty(A, 'contain', { get: function () { var self = this; var f = function (v, m) { return includeFn.call(self, v, m); }; f.keys = function () { self.flags.contains = true; return A.keys.apply(self, arguments); }; f.members = function (l) { self.flags.contains = true; return A.members.call(self, l); }; f.oneOf = function (l) { return A.oneOf.call(self, l); }; f.string = function (s) { return A.string.call(self, s); }; return f; } });
  Object.defineProperty(A, 'include', { get: function () { return this.contain; } });
  Object.defineProperty(A, 'includes', { get: function () { return this.contain; } });
  Object.defineProperty(A, 'contains', { get: function () { return this.contain; } });
  function expect(v, msg) { var a = new Assertion(v); if (msg) a.flags.msg = msg; return a; }
  expect.fail = function (m) { throw new AssertionError(m || 'expect.fail()'); };

  // minimal JSON schema validator (draft-07 core subset)
  function validateSchema(v, s, path) {
    var errs = [];
    if (!s || typeof s !== 'object') return errs;
    var t = typeOf(v);
    if (s.type) { var types = Array.isArray(s.type) ? s.type : [s.type]; var ok = types.some(function (tt) { if (tt === 'integer') return typeof v === 'number' && Math.floor(v) === v; if (tt === 'number') return typeof v === 'number'; return tt === t; }); if (!ok) errs.push(path + ' should be ' + types.join('|') + ' (got ' + t + ')'); }
    if (s.enum && !s.enum.some(function (e) { return deepEq(e, v); })) errs.push(path + ' should be one of ' + inspect(s.enum));
    if (s.const !== undefined && !deepEq(s.const, v)) errs.push(path + ' should equal ' + inspect(s.const));
    if (t === 'object') {
      (s.required || []).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(v, k)) errs.push(path + ' missing required property ' + inspect(k)); });
      if (s.properties) Object.keys(s.properties).forEach(function (k) { if (Object.prototype.hasOwnProperty.call(v, k)) errs = errs.concat(validateSchema(v[k], s.properties[k], path + '.' + k)); });
      if (s.additionalProperties === false) Object.keys(v).forEach(function (k) { if (!s.properties || !s.properties[k]) errs.push(path + ' has unexpected property ' + inspect(k)); });
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') Object.keys(v).forEach(function (k) { if (!s.properties || !s.properties[k]) errs = errs.concat(validateSchema(v[k], s.additionalProperties, path + '.' + k)); });
      if (s.minProperties !== undefined && Object.keys(v).length < s.minProperties) errs.push(path + ' has too few properties');
      if (s.maxProperties !== undefined && Object.keys(v).length > s.maxProperties) errs.push(path + ' has too many properties');
    }
    if (t === 'array') {
      if (s.items) { if (Array.isArray(s.items)) s.items.forEach(function (it, i) { if (i < v.length) errs = errs.concat(validateSchema(v[i], it, path + '[' + i + ']')); }); else v.forEach(function (x, i) { errs = errs.concat(validateSchema(x, s.items, path + '[' + i + ']')); }); }
      if (s.minItems !== undefined && v.length < s.minItems) errs.push(path + ' should have at least ' + s.minItems + ' items');
      if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(path + ' should have at most ' + s.maxItems + ' items');
      if (s.uniqueItems && v.some(function (x, i) { return v.findIndex(function (y) { return deepEq(x, y); }) !== i; })) errs.push(path + ' should have unique items');
    }
    if (t === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) errs.push(path + ' is too short');
      if (s.maxLength !== undefined && v.length > s.maxLength) errs.push(path + ' is too long');
      if (s.pattern && !(new RegExp(s.pattern)).test(v)) errs.push(path + ' does not match pattern ' + s.pattern);
      if (s.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errs.push(path + ' is not an email');
      if (s.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) errs.push(path + ' is not a uuid');
      if ((s.format === 'date-time' || s.format === 'date') && isNaN(Date.parse(v))) errs.push(path + ' is not a valid ' + s.format);
      if (s.format === 'uri' && !/^[a-z][a-z0-9+.-]*:/i.test(v)) errs.push(path + ' is not a uri');
    }
    if (t === 'number') {
      if (s.minimum !== undefined && v < s.minimum) errs.push(path + ' should be >= ' + s.minimum);
      if (s.maximum !== undefined && v > s.maximum) errs.push(path + ' should be <= ' + s.maximum);
      if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) errs.push(path + ' should be > ' + s.exclusiveMinimum);
      if (s.exclusiveMaximum !== undefined && v >= s.exclusiveMaximum) errs.push(path + ' should be < ' + s.exclusiveMaximum);
      if (s.multipleOf !== undefined && (v / s.multipleOf) % 1 !== 0) errs.push(path + ' should be a multiple of ' + s.multipleOf);
    }
    if (s.anyOf && !s.anyOf.some(function (sub) { return validateSchema(v, sub, path).length === 0; })) errs.push(path + ' does not match anyOf');
    if (s.oneOf && s.oneOf.filter(function (sub) { return validateSchema(v, sub, path).length === 0; }).length !== 1) errs.push(path + ' does not match exactly one of oneOf');
    if (s.allOf) s.allOf.forEach(function (sub) { errs = errs.concat(validateSchema(v, sub, path)); });
    if (s.not && validateSchema(v, s.not, path).length === 0) errs.push(path + ' should not match schema');
    if (s.nullable && v === null) return [];
    return errs;
  }

  // ---------- response assertions: pm.response.to.* ----------
  function responseAssertions(res) {
    function mk(not) {
      var api = {
        have: {
          status: function (s) { var ok = typeof s === 'number' ? res.code === s : res.status === s; if (ok === not) throw new AssertionError('expected response to ' + (not ? 'not ' : '') + 'have status ' + inspect(s) + ' but got ' + res.code + ' ' + res.status); },
          header: function (k, v) { var ok = v === undefined ? res.headers.has(k) : res.headers.get(k) === v; if (ok === not) throw new AssertionError('expected response to ' + (not ? 'not ' : '') + 'have header ' + inspect(k) + (v !== undefined ? ' = ' + inspect(v) : '') + ' (got ' + inspect(res.headers.get(k)) + ')'); },
          body: function (b) { var txt = res.text(); var ok = b === undefined ? txt.length > 0 : (b instanceof RegExp ? b.test(txt) : txt === b); if (ok === not) throw new AssertionError('expected response body to ' + (not ? 'not ' : '') + (b === undefined ? 'exist' : 'equal ' + inspect(b))); },
          jsonBody: function (p, v) { var j; try { j = res.json(); } catch (e) { if (!not) throw e; return; } if (p === undefined) { if (not) throw new AssertionError('expected response not to have a JSON body'); return; } var parts = String(p).replace(/\[(\d+)\]/g, '.$1').split('.'); var cur = j; var has = true; for (var i = 0; i < parts.length; i++) { if (cur == null || !Object.prototype.hasOwnProperty.call(Object(cur), parts[i])) { has = false; break; } cur = cur[parts[i]]; } var ok = v === undefined ? has : has && deepEq(cur, v); if (ok === not) throw new AssertionError('expected JSON body to ' + (not ? 'not ' : '') + 'have ' + inspect(p) + (v !== undefined ? ' = ' + inspect(v) : '') + (has ? ' (got ' + inspect(cur) + ')' : '')); },
          jsonSchema: function (s) { var errs = validateSchema(res.json(), s, '$'); if ((errs.length === 0) === not) throw new AssertionError(not ? 'expected JSON body not to match schema' : 'JSON schema mismatch: ' + errs.join('; ')); }
        },
        be: {
          get ok() { chk(res.code >= 200 && res.code < 300, 'ok (2xx)'); },
          get success() { chk(res.code >= 200 && res.code < 300, 'success (2xx)'); },
          get accepted() { chk(res.code === 202, 'accepted'); },
          get badRequest() { chk(res.code === 400, 'bad request'); },
          get unauthorized() { chk(res.code === 401, 'unauthorized'); },
          get forbidden() { chk(res.code === 403, 'forbidden'); },
          get notFound() { chk(res.code === 404, 'not found'); },
          get rateLimited() { chk(res.code === 429, 'rate limited'); },
          get clientError() { chk(res.code >= 400 && res.code < 500, 'client error (4xx)'); },
          get serverError() { chk(res.code >= 500, 'server error (5xx)'); },
          get error() { chk(res.code >= 400, 'error (4xx/5xx)'); },
          get redirection() { chk(res.code >= 300 && res.code < 400, 'redirection (3xx)'); },
          get info() { chk(res.code >= 100 && res.code < 200, 'info (1xx)'); },
          get json() { var ok = true; try { res.json(); } catch (e) { ok = false; } chk(ok, 'json'); },
          get withBody() { chk(res.text().length > 0, 'with body'); }
        }
      };
      function chk(cond, what) { if (cond === not) throw new AssertionError('expected response to ' + (not ? 'not ' : '') + 'be ' + what + ' (status ' + res.code + ')'); }
      return api;
    }
    var pos = mk(false); pos.not = mk(true); return pos;
  }

  // ---------- sendRequest ----------
  function sendRequest(reqLike, cb) {
    var r = typeof reqLike === 'string' ? { url: reqLike, method: 'GET' } : reqLike;
    var payload = { method: (r.method || 'GET').toUpperCase(), url: replaceIn(r.url), headers: {}, body: null };
    var h = r.header || r.headers;
    if (Array.isArray(h)) h.forEach(function (x) { payload.headers[x.key] = replaceIn(String(x.value)); }); else if (h && typeof h === 'object') Object.keys(h).forEach(function (k) { payload.headers[k] = replaceIn(String(h[k])); });
    if (r.body) {
      var b = r.body; if (typeof b === 'string') payload.body = { mode: 'raw', raw: replaceIn(b) };
      else if (b.mode === 'raw') { payload.body = { mode: 'raw', raw: replaceIn(typeof b.raw === 'string' ? b.raw : JSON.stringify(b.raw)) }; if (b.options && b.options.raw && b.options.raw.language) payload.body.language = b.options.raw.language; }
      else if (b.mode === 'urlencoded') payload.body = { mode: 'urlencoded', urlencoded: (b.urlencoded || []).map(function (x) { return { key: x.key, value: replaceIn(String(x.value)) }; }) };
      else if (b.mode === 'formdata') payload.body = { mode: 'formdata', formdata: (b.formdata || []).map(function (x) { return { key: x.key, value: replaceIn(String(x.value)) }; }) };
      else if (b.mode === 'graphql') payload.body = { mode: 'graphql', graphql: b.graphql };
      else payload.body = { mode: 'raw', raw: JSON.stringify(b), language: 'json' };
    }
    if (r.auth && r.auth.type === 'basic') { var bp = {}; (r.auth.basic || []).forEach(function (x) { bp[x.key] = x.value; }); payload.headers['Authorization'] = 'Basic ' + host.base64encode(replaceIn(bp.username || '') + ':' + replaceIn(bp.password || '')); }
    var result = host.sendRequest(JSON.stringify(payload));
    var parsed = JSON.parse(result);
    if (parsed.error) { if (cb) cb(new Error(parsed.error), undefined); return; }
    var rr = parsed.response; var hdrs = new HeaderList(rr.headers.map(function (x) { return { key: x[0], value: x[1] }; }));
    var resObj = { code: rr.status, status: rr.statusText, responseTime: rr.timeMs, responseSize: rr.size, headers: hdrs, text: function () { return rr.isBase64 ? host.base64decode(rr.body) : rr.body; }, json: function () { return JSON.parse(this.text()); }, stream: rr.body };
    resObj.to = responseAssertions(resObj);
    if (cb) cb(null, resObj);
    return resObj;
  }

  // ---------- cookies ----------
  var cookieList = new HeaderList((ctx.cookies || []).map(function (c) { return { key: c.name, value: c.value }; }));
  var cookies = { get: function (k) { return cookieList.get(k); }, has: function (k) { return cookieList.has(k); }, toObject: function () { return cookieList.toObject(); }, jar: function () { return { get: function (url, name, cb) { cb(null, cookieList.get(name)); }, set: function (url, name, value, cb) { if (cb) cb(null); }, getAll: function (url, cb) { cb(null, cookieList.all()); }, unset: function (u, n, cb) { if (cb) cb(null); }, clear: function (u, cb) { if (cb) cb(null); } }; } };

  // ---------- pm ----------
  var execution = {
    setNextRequest: function (n) { out.nextRequest = n === null ? null : String(n); },
    skipRequest: function () { out.skip = true; },
    location: ctx.info && ctx.info.location || [],
    get current() { return { name: request.name }; }
  };
  var pm = {
    info: ctx.info || {},
    globals: globals, environment: environment, collectionVariables: collectionVariables, variables: variables, iterationData: iterationData,
    request: request, response: response, cookies: cookies,
    test: test, expect: expect, sendRequest: sendRequest, execution: execution,
    vault: { get: function (k) { return host.vaultGet(k); } },
    require: function (name) { return requireShim(name); },
    visualizer: { set: function () {} }
  };
  var postman = { setNextRequest: execution.setNextRequest, setEnvironmentVariable: function (k, v) { environment.set(k, v); }, getEnvironmentVariable: function (k) { return environment.get(k); }, clearEnvironmentVariable: function (k) { environment.unset(k); }, setGlobalVariable: function (k, v) { globals.set(k, v); }, getGlobalVariable: function (k) { return globals.get(k); }, clearGlobalVariable: function (k) { globals.unset(k); } };
  global.pm = pm; global.postman = postman; global.expect = expect;
  global.tests = {};
  global.responseCode = response ? { code: response.code, name: response.status } : undefined;
  global.responseBody = response ? response.text() : undefined;
  global.responseTime = response ? response.responseTime : undefined;
  global.responseHeaders = response ? response.headers.toObject() : undefined;
  global.environment = environment.toObject(); global.globals = globals.toObject(); global.data = iterationData.toObject(); global.iteration = ctx.info && ctx.info.iteration;
  global.__finalize = function () { var t = global.tests; if (t && typeof t === 'object') Object.keys(t).forEach(function (k) { out.tests.push({ name: k, passed: !!t[k] }); }); };

  // ---------- require shims ----------
  function WordArray(hex) { this.hex = hex; }
  WordArray.prototype.toString = function (enc) { if (enc && enc.name === 'Base64') return host.hexToBase64(this.hex); if (enc && enc.name === 'Utf8') return host.hexToUtf8(this.hex); return this.hex; };
  var CryptoJS = {
    enc: { Hex: { name: 'Hex', stringify: function (w) { return w.hex; }, parse: function (h) { return new WordArray(h); } }, Base64: { name: 'Base64', stringify: function (w) { return host.hexToBase64(w.hex); }, parse: function (b) { return new WordArray(host.base64ToHex(b)); } }, Utf8: { name: 'Utf8', stringify: function (w) { return host.hexToUtf8(w.hex); }, parse: function (s) { return new WordArray(host.utf8ToHex(s)); } } },
    MD5: function (m) { return new WordArray(host.hash('md5', s(m))); }, SHA1: function (m) { return new WordArray(host.hash('sha1', s(m))); }, SHA256: function (m) { return new WordArray(host.hash('sha256', s(m))); }, SHA512: function (m) { return new WordArray(host.hash('sha512', s(m))); }, SHA384: function (m) { return new WordArray(host.hash('sha384', s(m))); },
    HmacSHA1: function (m, k) { return new WordArray(host.hmac('sha1', s(m), s(k))); }, HmacSHA256: function (m, k) { return new WordArray(host.hmac('sha256', s(m), s(k))); }, HmacSHA512: function (m, k) { return new WordArray(host.hmac('sha512', s(m), s(k))); }, HmacMD5: function (m, k) { return new WordArray(host.hmac('md5', s(m), s(k))); },
    AES: { encrypt: function (m, k) { return { toString: function () { return host.aes('enc', s(m), s(k)); } }; }, decrypt: function (c, k) { return new WordArray(host.utf8ToHex(host.aes('dec', s(c), s(k)))); } },
    lib: { WordArray: { random: function (n) { return new WordArray(host.randomHex(n)); } } }
  };
  function s(v) { return v instanceof WordArray ? host.hexToUtf8(v.hex) : String(v); }
  var uuid = { v4: function () { return host.uuid(); }, v1: function () { return host.uuid(); }, validate: function (u) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u); } };
  var lodash = {
    get: function (o, p, d) { var parts = Array.isArray(p) ? p : String(p).replace(/\[(\d+)\]/g, '.$1').split('.'); var cur = o; for (var i = 0; i < parts.length; i++) { if (cur == null) return d; cur = cur[parts[i]]; } return cur === undefined ? d : cur; },
    set: function (o, p, v) { var parts = String(p).replace(/\[(\d+)\]/g, '.$1').split('.'); var cur = o; for (var i = 0; i < parts.length - 1; i++) { if (cur[parts[i]] == null) cur[parts[i]] = {}; cur = cur[parts[i]]; } cur[parts[parts.length - 1]] = v; return o; },
    has: function (o, p) { return lodash.get(o, p, undefined) !== undefined; },
    isEqual: deepEq, isEmpty: function (v) { return v == null || (typeof v === 'object' ? Object.keys(v).length === 0 : String(v).length === 0); },
    pick: function (o, keys) { var r = {}; (Array.isArray(keys) ? keys : Array.prototype.slice.call(arguments, 1)).forEach(function (k) { if (k in o) r[k] = o[k]; }); return r; },
    omit: function (o, keys) { var r = {}; var ks = Array.isArray(keys) ? keys : Array.prototype.slice.call(arguments, 1); Object.keys(o).forEach(function (k) { if (ks.indexOf(k) < 0) r[k] = o[k]; }); return r; },
    map: function (c, f) { return Array.isArray(c) ? c.map(typeof f === 'string' ? function (x) { return x[f]; } : f) : Object.keys(c).map(function (k) { return f(c[k], k); }); },
    filter: function (c, f) { return (Array.isArray(c) ? c : Object.values(c)).filter(typeof f === 'function' ? f : function (x) { return Object.keys(f).every(function (k) { return x[k] === f[k]; }); }); },
    find: function (c, f) { return lodash.filter(c, f)[0]; }, uniq: function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }, flatten: function (a) { return [].concat.apply([], a); },
    sum: function (a) { return a.reduce(function (x, y) { return x + y; }, 0); }, sortBy: function (a, k) { return a.slice().sort(function (x, y) { var kx = typeof k === 'function' ? k(x) : x[k], ky = typeof k === 'function' ? k(y) : y[k]; return kx < ky ? -1 : kx > ky ? 1 : 0; }); },
    cloneDeep: function (o) { return JSON.parse(JSON.stringify(o)); }, merge: function (a) { for (var i = 1; i < arguments.length; i++) { var b = arguments[i]; for (var k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') lodash.merge(a[k], b[k]); else a[k] = b[k]; } } return a; },
    keys: Object.keys, values: Object.values, size: function (c) { return Array.isArray(c) || typeof c === 'string' ? c.length : Object.keys(c).length; }, isString: function (v) { return typeof v === 'string'; }, isNumber: function (v) { return typeof v === 'number'; }, isArray: Array.isArray, isObject: function (v) { return v !== null && typeof v === 'object'; }, random: function (a, b) { if (b === undefined) { b = a; a = 0; } return a + Math.floor(Math.random() * (b - a + 1)); }, times: function (n, f) { var r = []; for (var i = 0; i < n; i++) r.push(f(i)); return r; }, chunk: function (a, n) { var r = []; for (var i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; }, first: function (a) { return a[0]; }, last: function (a) { return a[a.length - 1]; }, includes: function (c, v) { return (Array.isArray(c) || typeof c === 'string') ? c.indexOf(v) >= 0 : Object.values(c).indexOf(v) >= 0; }, startsWith: function (s, p) { return String(s).indexOf(p) === 0; }, endsWith: function (s, p) { return String(s).slice(-p.length) === p; }, trim: function (s) { return String(s).trim(); }, camelCase: function (s) { return String(s).replace(/[-_\s]+(.)?/g, function (m, c) { return c ? c.toUpperCase() : ''; }).replace(/^./, function (c) { return c.toLowerCase(); }); }, snakeCase: function (s) { return String(s).replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase(); }, kebabCase: function (s) { return String(s).replace(/([a-z])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase(); }, capitalize: function (s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }, groupBy: function (a, k) { var r = {}; a.forEach(function (x) { var key = typeof k === 'function' ? k(x) : x[k]; (r[key] = r[key] || []).push(x); }); return r; }, keyBy: function (a, k) { var r = {}; a.forEach(function (x) { r[typeof k === 'function' ? k(x) : x[k]] = x; }); return r; }, range: function (a, b) { if (b === undefined) { b = a; a = 0; } var r = []; for (var i = a; i < b; i++) r.push(i); return r; }, isNil: function (v) { return v == null; }, isUndefined: function (v) { return v === undefined; }, isNull: function (v) { return v === null; }, isBoolean: function (v) { return typeof v === 'boolean'; }, isFunction: function (v) { return typeof v === 'function'; }, identity: function (v) { return v; }, noop: function () {}, toUpper: function (s) { return String(s).toUpperCase(); }, toLower: function (s) { return String(s).toLowerCase(); }, round: function (n, p) { var m = Math.pow(10, p || 0); return Math.round(n * m) / m; }, max: function (a) { return Math.max.apply(null, a); }, min: function (a) { return Math.min.apply(null, a); }, compact: function (a) { return a.filter(Boolean); }, difference: function (a, b) { return a.filter(function (x) { return b.indexOf(x) < 0; }); }, intersection: function (a, b) { return a.filter(function (x) { return b.indexOf(x) >= 0; }); }, forEach: function (c, f) { if (Array.isArray(c)) c.forEach(f); else Object.keys(c).forEach(function (k) { f(c[k], k); }); }, reduce: function (c, f, init) { return (Array.isArray(c) ? c : Object.values(c)).reduce(f, init); }, some: function (c, f) { return (Array.isArray(c) ? c : Object.values(c)).some(f); }, every: function (c, f) { return (Array.isArray(c) ? c : Object.values(c)).every(f); }, defaults: function (o, d) { for (var k in d) if (o[k] === undefined) o[k] = d[k]; return o; }, assign: Object.assign, extend: Object.assign, mapValues: function (o, f) { var r = {}; Object.keys(o).forEach(function (k) { r[k] = f(o[k], k); }); return r; }, mapKeys: function (o, f) { var r = {}; Object.keys(o).forEach(function (k) { r[f(o[k], k)] = o[k]; }); return r; }, invert: function (o) { var r = {}; Object.keys(o).forEach(function (k) { r[o[k]] = k; }); return r; }, toPairs: function (o) { return Object.keys(o).map(function (k) { return [k, o[k]]; }); }, fromPairs: function (p) { var r = {}; p.forEach(function (x) { r[x[0]] = x[1]; }); return r; }, zip: function () { var a = Array.prototype.slice.call(arguments); return a[0].map(function (_, i) { return a.map(function (x) { return x[i]; }); }); }, shuffle: function (a) { var r = a.slice(); for (var i = r.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = r[i]; r[i] = r[j]; r[j] = t; } return r; }, sample: function (a) { return a[Math.floor(Math.random() * a.length)]; }, padStart: function (s, n, c) { return String(s).padStart(n, c); }, padEnd: function (s, n, c) { return String(s).padEnd(n, c); }, repeat: function (s, n) { return String(s).repeat(n); }, split: function (s, d) { return String(s).split(d); }, join: function (a, d) { return a.join(d); }, uniqBy: function (a, k) { var seen = {}; return a.filter(function (x) { var key = typeof k === 'function' ? k(x) : x[k]; if (seen[key]) return false; seen[key] = true; return true; }); }, countBy: function (a, k) { var r = {}; a.forEach(function (x) { var key = typeof k === 'function' ? k(x) : x[k]; r[key] = (r[key] || 0) + 1; }); return r; }, orderBy: function (a, ks, ords) { ks = Array.isArray(ks) ? ks : [ks]; ords = ords || []; return a.slice().sort(function (x, y) { for (var i = 0; i < ks.length; i++) { var k = ks[i]; var kx = typeof k === 'function' ? k(x) : x[k], ky = typeof k === 'function' ? k(y) : y[k]; var d = kx < ky ? -1 : kx > ky ? 1 : 0; if (d) return ords[i] === 'desc' ? -d : d; } return 0; }); }, isMatch: function (o, src) { return Object.keys(src).every(function (k) { return deepEq(o[k], src[k]); }); }, now: function () { return host.now(); }, escape: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }, template: function (str) { return function (data) { return str.replace(/<%=\s*([\w.]+)\s*%>/g, function (m, k) { return lodash.get(data, k, ''); }); }; }
  };
  var momentShim = function (d) { var date = d === undefined ? new Date() : new Date(d); return { format: function (f) { if (!f) return date.toISOString(); var p = function (n, l) { return String(n).padStart(l || 2, '0'); }; return f.replace(/YYYY|MM|DD|HH|mm|ss|SSS|X|x/g, function (t) { switch (t) { case 'YYYY': return date.getFullYear(); case 'MM': return p(date.getMonth() + 1); case 'DD': return p(date.getDate()); case 'HH': return p(date.getHours()); case 'mm': return p(date.getMinutes()); case 'ss': return p(date.getSeconds()); case 'SSS': return p(date.getMilliseconds(), 3); case 'X': return Math.floor(date.getTime() / 1000); case 'x': return date.getTime(); } return t; }); }, toISOString: function () { return date.toISOString(); }, valueOf: function () { return date.getTime(); }, unix: function () { return Math.floor(date.getTime() / 1000); }, add: function (n, u) { var ms = { ms: 1, millisecond: 1, milliseconds: 1, s: 1000, second: 1000, seconds: 1000, m: 60000, minute: 60000, minutes: 60000, h: 3600000, hour: 3600000, hours: 3600000, d: 86400000, day: 86400000, days: 86400000, w: 604800000, week: 604800000, weeks: 604800000 }[u] || 1; return momentShim(date.getTime() + n * ms); }, subtract: function (n, u) { return this.add(-n, u); }, toDate: function () { return date; }, isValid: function () { return !isNaN(date.getTime()); }, diff: function (o, u) { var d = date.getTime() - new Date(o && o.toDate ? o.toDate() : o).getTime(); var ms = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 }[u] || 1; return Math.floor(d / ms); } }; };
  var ajvShim = function () { return { validate: function (schema, data) { this.errors = validateSchema(data, schema, '$').map(function (m) { return { message: m }; }); return this.errors.length === 0; }, compile: function (schema) { var self = this; var f = function (data) { f.errors = validateSchema(data, schema, '$').map(function (m) { return { message: m }; }); return f.errors.length === 0; }; return f; } }; };
  var tv4Shim = { validate: function (data, schema) { var errs = validateSchema(data, schema, '$'); tv4Shim.error = errs.length ? { message: errs[0] } : null; return errs.length === 0; }, validateResult: function (data, schema) { var errs = validateSchema(data, schema, '$'); return { valid: errs.length === 0, error: errs.length ? { message: errs[0] } : null }; } };
  function requireShim(name) {
    switch (name) {
      case 'crypto-js': return CryptoJS;
      case 'uuid': return uuid;
      case 'lodash': return lodash;
      case 'moment': return momentShim;
      case 'chai': return { expect: expect, assert: { equal: function (a, b, m) { expect(a, m).to.equal(b); }, deepEqual: function (a, b, m) { expect(a, m).to.eql(b); }, isTrue: function (a, m) { expect(a, m).to.be.true; }, isFalse: function (a, m) { expect(a, m).to.be.false; }, ok: function (a, m) { expect(a, m).to.be.ok; }, isOk: function (a, m) { expect(a, m).to.be.ok; }, exists: function (a, m) { expect(a, m).to.exist; }, strictEqual: function (a, b, m) { expect(a, m).to.equal(b); }, include: function (a, b, m) { expect(a, m).to.include(b); }, fail: expect.fail, isAbove: function (a, b, m) { expect(a, m).to.be.above(b); }, isBelow: function (a, b, m) { expect(a, m).to.be.below(b); }, lengthOf: function (a, n, m) { expect(a, m).to.have.lengthOf(n); }, typeOf: function (a, t, m) { expect(a, m).to.be.a(t); }, property: function (o, p, m) { expect(o, m).to.have.property(p); }, match: function (a, r, m) { expect(a, m).to.match(r); } } };
      case 'ajv': return ajvShim;
      case 'tv4': return tv4Shim;
      case 'xml2js': return { parseString: function (xml, opts, cb) { if (typeof opts === 'function') { cb = opts; } try { cb(null, JSON.parse(host.xml2json(xml))); } catch (e) { cb(e); } } };
      case 'atob': return global.atob;
      case 'btoa': return global.btoa;
      case 'postman-collection': return {};
      default: throw new Error('Module not available in sandbox: ' + name + ' (available: crypto-js, uuid, lodash, moment, chai, ajv, tv4, xml2js)');
    }
  }
  global.require = requireShim;
  global._ = lodash; global.CryptoJS = CryptoJS; global.moment = momentShim; global.xml2Json = function (xml) { return JSON.parse(host.xml2json(xml)); };
  global.atob = function (s) { return host.base64decode(s); }; global.btoa = function (s) { return host.base64encode(s); };
  global.setTimeout = function (fn, ms) { if (typeof fn === 'function') fn(); return 0; }; global.clearTimeout = function () {}; global.setInterval = function () { return 0; }; global.clearInterval = function () {};
  global.sleep = function (ms) { host.sleep(Math.min(Number(ms) || 0, 10000)); };
  global.Buffer = { from: function (s, enc) { var str = String(s); return { toString: function (to) { if (enc === 'base64') { var dec = host.base64decode(str); return to === 'hex' ? host.utf8ToHex(dec) : dec; } if (enc === 'hex') { return to === 'base64' ? host.hexToBase64(str) : host.hexToUtf8(str); } if (to === 'base64') return host.base64encode(str); if (to === 'hex') return host.utf8ToHex(str); return str; } }; } };
})(globalThis);
`
