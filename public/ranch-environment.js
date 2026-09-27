(function (root) {
  const scenes = {
    meadow: ['草甸', '山野草甸'],
    lake: ['湖畔', '湖畔林地'],
    courtyard: ['庭院', '京郊庭院'],
    wall: ['长城', '长城山谷'],
  };
  const seasons = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
  const storageKey = 'freebbs_ranch_scene';
  function seasonAt(now = Date.now()) {
    const month = new Date(now + 8 * 3600000).getUTCMonth() + 1;
    return month >= 3 && month <= 5
      ? 'spring'
      : month >= 6 && month <= 8
        ? 'summer'
        : month >= 9 && month <= 11
          ? 'autumn'
          : 'winter';
  }
  function nextMidnight(now = Date.now()) {
    const day = 86400000;
    return day - ((now + 8 * 3600000) % day);
  }
  function validScene(scene) {
    return Object.hasOwn(scenes, scene) ? scene : 'meadow';
  }
  function readScene(storage) {
    try {
      return validScene(storage.getItem(storageKey));
    } catch {
      return 'meadow';
    }
  }
  function photo(scene, season) {
    scene = validScene(scene);
    season = Object.hasOwn(seasons, season) ? season : seasonAt();
    return `/assets/ranch/${scene === 'meadow' ? '' : `${scene}/`}${season}.webp`;
  }
  const api = { scenes, seasons, storageKey, seasonAt, nextMidnight, validScene, readScene, photo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.FreeBbsRanchEnvironment = api;
    // Paint public scenery before waiting for account data; never cache a profile.
    if (document.body.classList.contains('ranch-page')) {
      let scene = 'meadow';
      try {
        scene = readScene(localStorage);
      } catch {
        /* Storage access may be disabled. */
      }
      const season = seasonAt();
      document.body.dataset.ranchSeason = season;
      document.body.dataset.ranchScene = scene;
      document.body.style.setProperty('--ranch-photo', `url("${photo(scene, season)}")`);
    }
  }
})(globalThis);
