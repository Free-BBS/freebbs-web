// Intentionally ES5-compatible: this file is loaded directly as a classic browser script.
/* eslint-disable func-names, no-nested-ternary, no-param-reassign, no-restricted-globals, no-var, object-shorthand, prefer-arrow-callback, strict, vars-on-top */
(function (root, factory) {
  'use strict';

  if (typeof module === 'object' && module.exports) {
    module.exports = factory;
    return;
  }

  root.TsinghuaCasFingerprint = factory(root.Fingerprint2);
})(
  typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this,
  function createTsinghuaCasFingerprint(Fingerprint2) {
    'use strict';

    // Matches the options used by Tsinghua's current fingerprintUtil.getFingers().
    var options = {
      excludeUserAgent: true,
      excludeScreenResolution: true,
      excludeAvailableScreenResolution: true,
      excludeTimezoneOffset: true,
      excludeAddBehavior: true,
      excludeOpenDatabase: true,
      excludeDoNotTrack: true,
      excludePlugins: true,
      excludeAdBlock: true,
      excludeHasLiedLanguages: true,
      excludeHasLiedResolution: true,
      excludeHasLiedOs: true,
      excludeHasLiedBrowser: true,
      excludeJsFonts: true,
      excludeFlashFonts: true,
      excludePixelRatio: true,
      excludeColorDepth: true,
    };

    if (typeof Object.freeze === 'function') {
      Object.freeze(options);
    }

    function generate() {
      return new Promise(function (resolve, reject) {
        if (typeof Fingerprint2 !== 'function') {
          reject(new Error('Fingerprint2 1.5.1 is unavailable.'));
          return;
        }

        var fingerprint = new Fingerprint2(options);
        fingerprint.get(function (value) {
          if (typeof value !== 'string' || !/^[0-9a-f]{32}$/i.test(value)) {
            reject(new Error('CAS fingerprint generator returned an invalid fingerprint.'));
            return;
          }

          resolve(value.toLowerCase());
        });
      });
    }

    var api = { generate: generate };
    return typeof Object.freeze === 'function' ? Object.freeze(api) : api;
  },
);
