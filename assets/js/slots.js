/* =========================================================
   残り枠カウンター
   ---------------------------------------------------------
   HTML側の書き方：

   <div class="slots" data-total="300" data-min="7" data-open="9" data-close="23">
     <p class="slots-v">残り <span class="slots-n">--</span><small>名様</small></p>
     <div class="gauge"><i class="slots-bar"></i></div>
   </div>

   data-total … 定員
   data-min   … 下限（これ以下には減りません）
   data-open  … 受付開始時刻（時）
   data-close … 締切時刻（時）
   data-start … 受付開始時点の残り枠の割合（既定 0.75 ＝ 300名中225名から開始）

   挙動：
   ① その日の「開始〜締切」の進み具合から残り枠を算出します。
      日付をシードにした微ゆらぎを加えるため、直線的には減りません。
      リロードしても値は飛びません（同じ時刻なら同じ値）。
   ② ページ滞在中は TICK_MIN〜TICK_MAX 秒ごとに 1 枠ずつ減ります。
   ③ 残りが THRESHOLD 以下になると「残りわずか」の表示に切り替わります。
   ========================================================= */
(function () {
  'use strict';

  var TICK_MIN   = 40;   // 滞在中に1枠減るまでの最短秒数
  var TICK_MAX   = 110;  // 同 最長秒数
  var THRESHOLD  = 30;   // この数以下で「残りわずか」表示

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* 日付＋時間帯をシードにした擬似乱数（-1〜1） */
  function jitter(d, salt) {
    var seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    var x = Math.sin(seed * 9301 + salt * 49297) * 233280;
    return (x - Math.floor(x)) * 2 - 1;
  }

  /* 現在時刻から残り枠の基準値を求める
     受付開始の時点で「定員 × start」から始めるため、満枠表示にはなりません。
     開始前は start の値、締切後は下限を表示します。 */
  function baseLeft(cfg) {
    var now   = new Date();
    var hour  = now.getHours() + now.getMinutes() / 60;
    var first = Math.round(cfg.total * cfg.start);

    var p = (hour - cfg.open) / (cfg.close - cfg.open);
    p = clamp(p, 0, 1);

    /* 序盤はゆっくり、夕方から加速させる */
    var eased = Math.pow(p, 1.6);
    var left  = first - (first - cfg.min) * eased;

    /* 1時間ごとに変わる微ゆらぎ（±全体の2%程度） */
    left += jitter(now, now.getHours() + 1) * cfg.total * 0.02;

    return Math.round(clamp(left, cfg.min, first));
  }

  function render(el, cfg, animate) {
    var n   = el.querySelector('.slots-n');
    var bar = el.querySelector('.slots-bar');

    if (n) {
      n.textContent = cfg.left;
      if (animate && !reduceMotion) {
        el.classList.remove('bump');
        void el.offsetWidth;           /* リフローで再生し直す */
        el.classList.add('bump');
      }
    }
    if (bar) {
      var used = (cfg.total - cfg.left) / cfg.total * 100;
      bar.style.width = clamp(used, 0, 100).toFixed(1) + '%';
    }
    el.classList.toggle('few', cfg.left <= THRESHOLD);
  }

  function start(el) {
    var cfg = {
      total: parseInt(el.dataset.total, 10) || 300,
      min:   parseInt(el.dataset.min,   10) || 5,
      open:  parseFloat(el.dataset.open)  || 9,
      close: parseFloat(el.dataset.close) || 23,
      /* 受付開始時点の残り枠の割合（0.75 なら 300名中225名から始まる） */
      start: parseFloat(el.dataset.start) || 0.75
    };
    if (cfg.close <= cfg.open) cfg.close = cfg.open + 1;
    cfg.start = clamp(cfg.start, 0.1, 1);

    cfg.left = baseLeft(cfg);
    render(el, cfg, false);

    /* 滞在中の自動減少 */
    (function tick() {
      var wait = (TICK_MIN + Math.random() * (TICK_MAX - TICK_MIN)) * 1000;
      setTimeout(function () {
        if (cfg.left > cfg.min) {
          cfg.left -= 1;
          render(el, cfg, true);
        }
        tick();
      }, wait);
    })();

    /* タブに戻ってきたら時刻ベースで引き直す（放置後のズレ防止） */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      var b = baseLeft(cfg);
      if (b < cfg.left) { cfg.left = b; render(el, cfg, true); }
    });
  }

  function init() {
    var list = document.querySelectorAll('.slots');
    for (var i = 0; i < list.length; i++) start(list[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
