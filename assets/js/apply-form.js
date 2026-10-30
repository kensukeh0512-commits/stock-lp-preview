/* =========================================================
   電話申込フォームの送信（Googleスプレッドシートへ保存）
   ---------------------------------------------------------
   受け口は Apps Script のウェブアプリです。
   サーバー側のコードと設置手順は、公開リポジトリの外、
   form-backend/ にあります。

   ページの <head> で設定してください：

     <script>
     window.APPLY_FORM = {
       endpoint: '',   // Apps Script の /exec URL
       siteKey : '',   // Apps Script 側の SITE_KEY と同じ値（任意）
       consent : '…'   // 同意欄の文面。保存して記録に残します
     };
     </script>
     <script src="assets/js/apply-form.js" defer></script>

   endpoint が空のあいだは送信しません。ボタンは disabled のままで、
   「準備中」の案内を出します。設定するとボタンが自動的に有効になります。
   受け付けられないのに「受け付けました」と見せないための作りです。

   ---------------------------------------------------------
   送信の作り

   ・Content-Type は text/plain
       Apps Script のウェブアプリは OPTIONS（CORSの事前確認）を
       受け取れません。application/json にすると事前確認が発生して
       送信自体が失敗します。text/plain なら事前確認が起きないため、
       JSON を本文に入れて text/plain で送り、サーバー側で JSON.parse します。

   ・受付ID（UUID）を付ける
       同じ受付IDの申込は、サーバー側で二重に保存されません。
       そのため、返事が返ってこなかったときに送り直しても安全です。
       受付IDは sessionStorage に残すので、再読み込み後の送り直しでも
       行が増えません。

   ・返事が返るまで送信をロックする
       連打しても2回送られません。

   ・通信が失敗したら、自動で2回だけ送り直す
       それでも駄目なときは、成功したように見せず、
       理由とやり直しの案内を出します。

   ・個人情報をURLに載せない
       すべて POST の本文で送ります。
       コンソールにも氏名・電話番号は出しません。
   ========================================================= */
(function () {
  'use strict';

  var cfg = window.APPLY_FORM || {};
  var ENDPOINT = String(cfg.endpoint || '').trim();

  var TIMEOUT  = 12000;   // 1回の送信を待つ上限
  var RETRIES  = 2;       // 自動で送り直す回数
  var BACKOFF  = [1200, 3000];

  var TOKEN_KEY = 'apply_token_v1';
  var DONE_KEY  = 'apply_done_v1';

  var MSG = {
    sending : '送信しています…',
    offline : 'インターネットに接続されていないようです。通信状況をご確認のうえ、もう一度お試しください。',
    network : '送信できませんでした。通信状況をご確認のうえ、もう一度お試しください。',
    server  : 'ただいま受付ができませんでした。お手数ですが、時間をおいてもう一度お試しください。',
    again   : 'もう一度お試しいただいても、二重のお申し込みにはなりません。'
  };


  /* ===== 受付ID ========================================== */

  function uuid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      if (window.crypto && crypto.getRandomValues) {
        var a = new Uint8Array(16);
        crypto.getRandomValues(a);
        var s = '';
        for (var i = 0; i < a.length; i++) {
          s += ('0' + a[i].toString(16)).slice(-2);
        }
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

  function clearToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }


  /* ===== 画面 ============================================ */

  var f, btn, msg, done, notready, hp, openedAt = Date.now();
  var sending = false;
  var btnHtml = '';

  function show(el, on) { if (el) el.hidden = !on; }

  function note(text, kind) {
    if (!msg) return;
    if (!text) { msg.hidden = true; msg.textContent = ''; return; }
    msg.className = 'fm-msg' + (kind ? ' is-' + kind : '');
    msg.textContent = text;
    msg.hidden = false;
  }

  function lock(on) {
    sending = on;
    if (!btn) return;
    btn.disabled = on;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    if (on) {
      if (!btnHtml) btnHtml = btn.innerHTML;
      btn.innerHTML = '送信しています…';
    } else if (btnHtml) {
      btn.innerHTML = btnHtml;
    }
  }

  /**
   * 送信が終わった状態にする。入力欄とボタンは隠す。
   * move は、送信直後だけ true。
   * 読み込み直後に画面を動かすと、何が起きたか分からないため。
   */
  function finish(move) {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    clearToken();
    note('', '');
    var rows = f.querySelectorAll('.fm-row, .fm-agree, .fm-hp, .notready, .btn, .btn-note');
    for (var i = 0; i < rows.length; i++) rows[i].hidden = true;
    show(done, true);
    if (done && move) {
      done.setAttribute('tabindex', '-1');
      done.focus();
      done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }


  /* ===== 入力チェック ==================================== */

  function flag(el, on) {
    var e = document.querySelector('.err[data-for="' + el.id + '"]');
    if (e) e.style.display = on ? 'block' : 'none';
    var row = el.closest('.fm-row, .fm-agree');
    if (row) row.classList.toggle('ng', on);
    if (on) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  }

  function tel(v) {
    return String(v).replace(/[-\s　()]/g, '')
      .replace(/[０-９]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      });
  }

  function check() {
    var ok = true;
    var name = document.getElementById('fName');
    var num  = document.getElementById('fTel');
    var time = document.getElementById('fTime');
    var agr  = document.getElementById('fAgree');

    if (!name.value.trim()) { flag(name, true); ok = false; } else flag(name, false);
    if (!/^0\d{9,10}$/.test(tel(num.value))) { flag(num, true); ok = false; } else flag(num, false);
    if (!time.value) { flag(time, true); ok = false; } else flag(time, false);
    if (!agr.checked) { flag(agr, true); ok = false; } else flag(agr, false);

    return ok;
  }

  function payload() {
    var g = function (id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    };
    return {
      token   : token(),
      siteKey : String(cfg.siteKey || ''),
      name    : g('fName').trim(),
      tel     : tel(g('fTel')),
      time    : g('fTime'),
      experience: g('fExp'),
      fund    : g('fFund'),
      holding : g('fHold'),
      agree   : !!document.getElementById('fAgree').checked,
      consent : String(cfg.consent || ''),
      /* 検索条件やタグが混ざらないよう、パス名だけ送る */
      page    : location.pathname,
      company : hp ? hp.value : '',
      elapsed : Date.now() - openedAt
    };
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

  function send(data, left) {
    return post(data).then(function (r) {
      if (r && r.ok) return r;
      /* サーバーが retry を立てたときだけ送り直す */
      if (r && r.retry && left > 0) return wait(left).then(function () {
        return send(data, left - 1);
      });
      return r;
    }, function (e) {
      if (e && e.retry && left > 0) return wait(left).then(function () {
        return send(data, left - 1);
      });
      throw e;
    });
  }

  /**
   * 送り直すまでの待ち時間。
   * 画面の文言も変える。黙って待たされると、
   * 止まったのか動いているのか分からないため。
   */
  function wait(left) {
    var n = RETRIES - left + 1;
    note(MSG.sending + '（送り直しています ' + n + '回目）', 'wait');
    return new Promise(function (r) { setTimeout(r, BACKOFF[n - 1] || 3000); });
  }


  /* ===== 組み立て ======================================== */

  function submit(ev) {
    ev.preventDefault();
    if (sending) return;

    if (!check()) {
      var bad = f.querySelector('.ng');
      if (bad) {
        bad.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var i = bad.querySelector('input, select');
        if (i) i.focus();
      }
      return;
    }

    if (!ENDPOINT) return;   /* 準備中。ボタンも disabled。 */

    if (navigator.onLine === false) {
      note(MSG.offline, 'ng');
      return;
    }

    lock(true);
    note(MSG.sending, 'wait');

    send(payload(), RETRIES).then(function (r) {
      if (r && r.ok) {
        /* status は saved か duplicate。どちらも受付は済んでいる。 */
        finish(true);
        return;
      }
      lock(false);
      note((r && r.message ? r.message : MSG.server) + '\n' + MSG.again, 'ng');
    }, function (e) {
      lock(false);
      var m = (e && e.message === 'network') ? MSG.network : MSG.server;
      note(m + '\n' + MSG.again, 'ng');
      /* 失敗の事実だけ残す。入力内容は書かない。 */
      if (window.console) console.warn('[apply] 送信失敗: ' + (e && e.message));
    });
  }

  function init() {
    f = document.getElementById('applyForm');
    if (!f) return;

    btn      = document.getElementById('submitBtn');
    msg      = document.getElementById('applyMsg');
    done     = document.getElementById('applyDone');
    notready = f.querySelector('.notready');
    hp       = f.querySelector('[name="company"]');

    /* 一度エラーを出した項目は、直したらすぐ消す */
    var ins = f.querySelectorAll('input, select');
    for (var i = 0; i < ins.length; i++) {
      (function (el) {
        var ev = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(ev, function () {
          if (el.getAttribute('aria-invalid')) flag(el, false);
        });
      })(ins[i]);
    }

    f.addEventListener('submit', submit);

    /* 送信先が決まっていれば受付を開く */
    if (ENDPOINT) {
      f.setAttribute('action', ENDPOINT);
      f.setAttribute('method', 'post');
      show(notready, false);
      if (btn) {
        btn.disabled = false;
        var t = btn.innerHTML.replace('（準備中）', '');
        btn.innerHTML = t;
      }
    }

    /* 同じ端末で既に申し込み済みなら、完了の表示にする */
    var already = false;
    try { already = localStorage.getItem(DONE_KEY) === '1'; } catch (e) {}
    if (already && ENDPOINT) finish(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
