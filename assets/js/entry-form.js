/* =========================================================
   メール登録フォーム（お名前・メールアドレス）
   ---------------------------------------------------------
   LP①（/）と LP②（/b/）で共通に使います。

   受け口は Apps Script のウェブアプリです。
   サーバー側のコードと設置手順は、公開リポジトリの外、
   form-backend/ にあります。そこから配信スタンドへ中継され、
   同時にスプレッドシートへ1行保存されます。

   各ページの <head> で設定してください：

     <script>
     window.LP_FORM = {
       endpoint: '',            // Apps Script の /exec URL
       siteKey : '',            // Apps Script 側の SITE_KEY と同じ値（任意）
       variant : 'A',           // 登録元。A か B
       thanks  : 'thanks.html'  // 登録できたときの遷移先
     };
     </script>
     <script src="assets/js/entry-form.js" defer></script>

   ---------------------------------------------------------
   遷移の決まり

   ・登録できたときだけ thanks へ進みます。
   ・失敗したときは進みません。画面にそのまま理由を出します。
       「登録できていないのに、ありがとうございましたと見せない」
       ためです。
   ・thanks のURLには ?variant= を付けます。
     サンキューページの電話申込フォームが、この値を引き継ぎます。

   endpoint が空のあいだは、送信せずに thanks へ進むだけです
   （配信スタンドが決まる前からの挙動をそのまま残しています）。
   入力内容はどこにも送られません。

   ---------------------------------------------------------
   送信の作り

   ・Content-Type は text/plain
       Apps Script のウェブアプリは OPTIONS（CORSの事前確認）を
       受け取れません。application/json にすると事前確認が発生して
       送信自体が失敗します。text/plain なら事前確認が起きないため、
       JSON を本文に入れて text/plain で送り、サーバー側で JSON.parse します。

   ・受付ID（UUID）を付ける
       同じ受付IDの登録は、サーバー側で二重に保存されません。
       返事が返ってこなかったときに送り直しても安全です。

   ・返事が返るまでボタンを止める
       連打しても2回送られません。

   ・通信が失敗したら、自動で2回だけ送り直す
       それでも駄目なときは、成功したように見せません。

   ・個人情報をURLに載せない
       すべて POST の本文で送ります。
       コンソールにも氏名・メールアドレスは出しません。

   HTML側の書き方：
     <form data-entry novalidate>
       <input data-f="name"  ...  aria-describedby="e-name">
       <p class="err" id="e-name" hidden></p>
       <input data-f="email" ...  aria-describedby="e-mail">
       <p class="err" id="e-mail" hidden></p>
       <div class="row" data-entry-msg hidden>
         <p class="err" role="alert" aria-live="polite"></p>
       </div>
       <button type="submit">…</button>
     </form>
   ========================================================= */
(function () {
  'use strict';

  var cfg      = window.LP_FORM || {};
  var ENDPOINT = String(cfg.endpoint || '').trim();
  var THANKS   = cfg.thanks || 'thanks.html';

  var TIMEOUT  = 12000;   // 1回の送信を待つ上限
  var RETRIES  = 2;       // 自動で送り直す回数
  var BACKOFF  = [1200, 3000];

  var TOKEN_KEY = 'entry_token_v1';
  /* サンキューページの電話申込フォームが読む。登録元をたどれるようにする。 */
  var ENTRY_KEY = 'lp_entry_v1';

  /* 厳密に弾くと正当なアドレスまで落とすので、明らかな誤りだけを見る。
     サーバー側も同じ判定にしてある。 */
  var RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var MSG = {
    name   : 'お名前をご入力ください。',
    empty  : 'メールアドレスをご入力ください。',
    bad    : 'メールアドレスの形式をご確認ください。',
    sending: '送信しています…',
    offline: 'インターネットに接続されていないようです。通信状況をご確認のうえ、もう一度お試しください。',
    network: '登録できませんでした。通信状況をご確認のうえ、もう一度お試しください。',
    server : 'ただいま登録ができませんでした。お手数ですが、もう一度お試しください。',
    again  : '二重登録にはなりません。'
  };

  var openedAt = Date.now();


  /* ===== 受付ID ========================================== */

  function uuid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      if (window.crypto && crypto.getRandomValues) {
        var a = new Uint8Array(16);
        crypto.getRandomValues(a);
        var s = '';
        for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
        return s;
      }
    } catch (e) {}
    /* 乱数が使えない環境向けの最後の手段。衝突しにくい形にはしてある。 */
    return (Date.now().toString(36) + '-' +
            Math.random().toString(36).slice(2, 10) +
            Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9-]/g, '');
  }

  function token() {
    var t = '';
    try { t = sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
    if (!/^[A-Za-z0-9-]{16,64}$/.test(t)) {
      t = uuid();
      try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) {}
    }
    return t;
  }


  /* ===== 登録元・流入元 ================================== */

  /* ab-track.js が読み込まれていればそちらを使う（同じ判定を2か所に書かない）。
     入っていないページでは LP_FORM.variant を使う。 */
  function trk(key, fallback) {
    var t = window.LP_TRACK;
    if (t && t[key]) return String(t[key]);
    return fallback || '';
  }

  function variant() {
    var v = trk('variant', String(cfg.variant || ''));
    return (v && v !== 'unknown') ? v : String(cfg.variant || '');
  }


  /* ===== 画面 ============================================ */

  function msgBox(f) {
    var row = f.querySelector('[data-entry-msg]');
    if (!row) return null;
    return { row: row, p: row.querySelector('p') || row };
  }

  /** kind に 'wait' を渡すと、失敗ではなく進行中の色で出す。 */
  function note(box, text, kind) {
    if (!box) return;
    if (!text) { box.row.hidden = true; box.p.textContent = ''; return; }
    box.p.className = 'err' + (kind ? ' is-' + kind : '');
    box.p.textContent = text;
    box.row.hidden = false;
  }

  /** 送信中はボタンを止め、文言を差し替える。見た目は既存のままにする。 */
  function lock(btn, on, keep) {
    if (!btn) return;
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    if (on) {
      btn.innerHTML = '<span>' + MSG.sending + '</span>';
    } else if (keep) {
      btn.innerHTML = keep;
    }
  }


  /* ===== 入力チェック ==================================== */

  function flag(input, text) {
    var id = input.getAttribute('aria-describedby');
    var box = id ? document.getElementById(id) : null;
    if (text) {
      input.setAttribute('aria-invalid', 'true');
      if (box) { box.textContent = text; box.hidden = false; }
    } else {
      input.removeAttribute('aria-invalid');
      if (box) { box.hidden = true; box.textContent = ''; }
    }
  }

  function check(nm, em) {
    var bad = null;

    if (!nm.value.replace(/[\s　]/g, '')) {
      flag(nm, MSG.name); bad = bad || nm;
    } else { flag(nm, ''); }

    var v = em.value.trim();
    if (!v) {
      flag(em, MSG.empty); bad = bad || em;
    } else if (!RE.test(v)) {
      flag(em, MSG.bad); bad = bad || em;
    } else { flag(em, ''); }

    return bad;
  }


  /* ===== 送信 ============================================ */

  function post(data) {
    var ac = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ac) ac.abort(); }, TIMEOUT);

    return fetch(ENDPOINT, {
      method: 'POST',
      /* text/plain にすることで CORS の事前確認を起こさない */
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data),
      redirect: 'follow',
      signal: ac ? ac.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        var err = new Error('http ' + res.status);
        /* 5xx は一時的な不調の可能性があるので送り直す */
        err.retry = res.status >= 500;
        throw err;
      }
      return res.text().then(function (t) {
        try { return JSON.parse(t); } catch (e) {
          var err2 = new Error('bad json');
          err2.retry = true;
          throw err2;
        }
      });
    }, function (e) {
      clearTimeout(timer);
      var err = new Error(e && e.name === 'AbortError' ? 'timeout' : 'network');
      err.retry = true;
      throw err;
    });
  }

  function send(data, left, box) {
    return post(data).then(function (r) {
      if (r && r.ok) return r;
      /* サーバーが retry を立てたときだけ送り直す */
      if (r && r.retry && left > 0) {
        return wait(left, box).then(function () { return send(data, left - 1, box); });
      }
      return r;
    }, function (e) {
      if (e && e.retry && left > 0) {
        return wait(left, box).then(function () { return send(data, left - 1, box); });
      }
      throw e;
    });
  }

  /**
   * 送り直すまでの待ち時間。
   * 画面の文言も変える。黙って待たされると、
   * 止まったのか動いているのか分からないため。
   */
  function wait(left, box) {
    var n = RETRIES - left + 1;
    note(box, MSG.sending + '（送り直しています ' + n + '回目）', 'wait');
    return new Promise(function (r) { setTimeout(r, BACKOFF[n - 1] || 3000); });
  }

  function payload(nm, em, hp) {
    return {
      token   : token(),
      siteKey : String(cfg.siteKey || ''),
      name    : nm.value.trim(),
      email   : em.value.trim(),
      variant : variant(),
      src     : trk('src', ''),
      campaign: trk('campaign', ''),
      /* 検索条件やタグが混ざらないよう、パス名だけ送る */
      page    : location.pathname,
      device  : trk('device', ''),
      company : hp ? hp.value : '',
      elapsed : Date.now() - openedAt
    };
  }


  /* ===== 遷移 ============================================ */

  /** 登録できたときだけ呼ぶ。 */
  function goThanks(v, tk) {
    /* 電話申込フォームが登録元をたどれるようにしておく。
       メールアドレスは入れない（必要がないため）。 */
    try {
      localStorage.setItem(ENTRY_KEY, JSON.stringify({
        variant: v || '', token: tk || '', at: Date.now()
      }));
    } catch (e) {}
    try { sessionStorage.setItem('lp_variant', v || ''); } catch (e) {}

    var to = THANKS;
    if (v && to.indexOf('variant=') < 0) {
      to += (to.indexOf('?') >= 0 ? '&' : '?') + 'variant=' + encodeURIComponent(v);
    }
    window.location.href = to;
  }


  /* ===== 組み立て ======================================== */

  function setup(f) {
    var nm = f.querySelector('[data-f="name"]');
    var em = f.querySelector('[data-f="email"]');
    if (!nm || !em) return;

    var btn  = f.querySelector('button[type="submit"], button:not([type])');
    var keep = btn ? btn.innerHTML : '';
    var box  = msgBox(f);
    var busy = false;

    /* おとり欄。人には見せないが、display:none にはしない。
       自動プログラムは display:none の欄を飛ばすことがあるため、
       画面の外に出すだけにしてある。
       2つのLPで同じものを書かないよう、ここで作って差し込む。 */
    var hp = null;
    if (ENDPOINT) {
      var wrap = document.createElement('div');
      wrap.setAttribute('aria-hidden', 'true');
      wrap.style.cssText = 'position:absolute;left:-9999px;top:auto;' +
                           'width:1px;height:1px;overflow:hidden';
      hp = document.createElement('input');
      hp.type = 'text';
      hp.name = 'company';
      hp.tabIndex = -1;
      hp.autocomplete = 'off';
      wrap.appendChild(hp);
      f.appendChild(wrap);
    }

    /* 送信先が未設定のあいだは、従来どおり素の form として振る舞わせる */
    if (!ENDPOINT && cfg.action) {
      var fields = cfg.fields || {};
      if (fields.name)  nm.setAttribute('name', fields.name);
      if (fields.email) em.setAttribute('name', fields.email);
      f.setAttribute('action', cfg.action);
      f.setAttribute('method', cfg.method || 'post');
    }

    /* 一度エラーを出した項目は、直したらすぐ消す */
    [nm, em].forEach(function (i) {
      i.addEventListener('input', function () {
        if (i.getAttribute('aria-invalid')) flag(i, '');
      });
    });

    f.addEventListener('submit', function (ev) {
      if (busy) { ev.preventDefault(); return; }

      var bad = check(nm, em);
      if (bad) {
        ev.preventDefault();
        note(box, '');
        bad.focus();
        return;
      }

      if (window.LP_TRACK && window.LP_TRACK.push) {
        window.LP_TRACK.push('lp_form_submit', { lp_cta_name: 'entry-form' });
      }

      /* 送信先が未設定のあいだは、送らずにサンキューページへ。
         配信スタンドが決まる前からの挙動をそのまま残している。 */
      if (!ENDPOINT) {
        ev.preventDefault();
        goThanks(variant(), '');
        return;
      }

      ev.preventDefault();

      if (navigator.onLine === false) {
        note(box, MSG.offline);
        return;
      }

      busy = true;
      lock(btn, true);
      note(box, MSG.sending, 'wait');

      var data = payload(nm, em, hp);

      send(data, RETRIES, box).then(function (r) {
        if (r && r.ok) {
          /* status は saved か duplicate。どちらも登録は済んでいる。 */
          goThanks(r.variant || data.variant, data.token);
          return;
        }
        busy = false;
        lock(btn, false, keep);
        note(box, (r && r.message ? r.message : MSG.server) + ' ' + MSG.again);

      }, function (e) {
        busy = false;
        lock(btn, false, keep);
        note(box, (e && e.message === 'network' ? MSG.network : MSG.server) +
                  ' ' + MSG.again);
        /* 失敗の事実だけ残す。入力内容は書かない。 */
        if (window.console) console.warn('[entry] 登録失敗: ' + (e && e.message));
      });
    });
  }

  function init() {
    var forms = document.querySelectorAll('form[data-entry]');
    for (var i = 0; i < forms.length; i++) setup(forms[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
