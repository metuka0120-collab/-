'use strict';

/**
 * わんコメ（OneComme）から、コメントした人の名前とアイコンを取り込む。
 *
 * わんコメはPCの中に API を持っていて、コメントが来るたびに WebSocket で流してくれる。
 *   既定の接続先： ws://127.0.0.1:11180/sub
 *
 * 参加型管理の待機列そのものは読まない（参加者の整列はわんコメ側の仕事）。
 * こちらは「最近コメントした人」を覚えておき、対戦を記録するときに
 * 名前とアイコンをワンタッチで入れられるようにする。
 *
 * わんコメのバージョンによってJSONの形が少し違うことがあるので、
 * 名前・アイコン・ユーザーIDは「あちこち探して見つかったものを使う」方針にしている。
 */

const WebSocket = require('ws');

const DEFAULT_URL = 'ws://127.0.0.1:11180/sub';
const KEEP = 60;              // 覚えておくコメント者の人数
const RECONNECT_MIN = 2000;
const RECONNECT_MAX = 30000;

function str(v) {
  return String(v == null ? '' : v).trim();
}

/**
 * わんコメのコメント1件から、欲しい情報だけ取り出す。
 * 形が違っても拾えるように、入れ子の data も見る。
 */
function pickComment(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const inner = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
  const get = (...keys) => {
    for (const key of keys) {
      const a = str(inner[key]);
      if (a) return a;
      const b = str(raw[key]);
      if (b) return b;
    }
    return '';
  };

  const name = get('displayName', 'name', 'nickname', 'userName');
  if (!name) return null;

  return {
    // 同じ人をまとめるための鍵。userId が無ければ名前で代用する
    userId: get('userId', 'liveId', 'originalProfileImage') || 'name:' + name,
    name,
    profileImage: get('profileImage', 'profileImageUrl', 'originalProfileImage', 'icon'),
    comment: get('comment', 'commentText', 'text'),
    service: str(raw.service || inner.service),
    at: get('timestamp', 'createdAt', 'time') || new Date().toISOString()
  };
}

/** メッセージ全体から、コメントの配列を取り出す */
function extractComments(message) {
  if (!message || typeof message !== 'object') return [];

  // 想定している形： { type: 'comments', data: { comments: [...] } }
  //                  { type: 'comments', data: [...] }
  const type = str(message.type);
  if (type && type !== 'comments' && type !== 'connected') return [];

  const data = message.data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.comments)) return data.comments;
  if (Array.isArray(message.comments)) return message.comments;
  return [];
}

class OneCommeClient {
  /** @param {function} onChange 状態が変わったときに呼ばれる */
  constructor(onChange) {
    this.onChange = typeof onChange === 'function' ? onChange : function () {};
    this.enabled = false;
    this.url = DEFAULT_URL;

    this.socket = null;
    this.connected = false;
    this.lastError = '';
    this.lastMessageAt = null;
    this.retryDelay = RECONNECT_MIN;
    this.retryTimer = null;
    this.closing = false;

    this.list = [];       // 最近コメントした人（新しい順）
    this.byId = new Map();
  }

  status() {
    return {
      enabled: this.enabled,
      url: this.url,
      connected: this.connected,
      lastError: this.lastError,
      lastMessageAt: this.lastMessageAt,
      count: this.list.length
    };
  }

  commenters() {
    return this.list;
  }

  /** 設定を反映する。URLや有効/無効が変わったら繋ぎ直す */
  configure(settings) {
    const nextEnabled = !!(settings && settings.enabled);
    const nextUrl = str(settings && settings.url) || DEFAULT_URL;
    const changed = nextEnabled !== this.enabled || nextUrl !== this.url;

    this.enabled = nextEnabled;
    this.url = nextUrl;

    if (changed) this.restart();
    return this.status();
  }

  restart() {
    this.stop();
    this.retryDelay = RECONNECT_MIN;
    if (this.enabled) this.connect();
    else this.onChange();
  }

  stop() {
    this.closing = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      try { this.socket.terminate(); } catch (err) { /* すでに閉じている */ }
      this.socket = null;
    }
    this.connected = false;
    this.closing = false;
  }

  connect() {
    if (!this.enabled) return;

    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      this.lastError = 'URLが正しくありません（' + err.message + '）';
      this.connected = false;
      this.onChange();
      this.scheduleRetry();
      return;
    }

    this.socket = socket;

    socket.on('open', () => {
      this.connected = true;
      this.lastError = '';
      this.retryDelay = RECONNECT_MIN;
      this.onChange();
    });

    socket.on('message', (raw) => {
      this.lastMessageAt = new Date().toISOString();
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (err) {
        return; // わんコメ以外のメッセージは無視
      }
      const comments = extractComments(message);
      if (!comments.length) return;

      let changed = false;
      for (const item of comments) {
        if (this.remember(pickComment(item))) changed = true;
      }
      if (changed) this.onChange();
    });

    socket.on('close', () => {
      this.connected = false;
      this.socket = null;
      if (!this.closing) {
        this.onChange();
        this.scheduleRetry();
      }
    });

    socket.on('error', (err) => {
      this.lastError = err && err.message ? err.message : '接続できません';
      this.connected = false;
    });
  }

  scheduleRetry() {
    if (!this.enabled || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retryDelay);
    if (this.retryTimer.unref) this.retryTimer.unref();
    this.retryDelay = Math.min(this.retryDelay * 2, RECONNECT_MAX);
  }

  /** コメントした人を覚える。同じ人は上書きして先頭に持ってくる */
  remember(person) {
    if (!person) return false;

    const existing = this.byId.get(person.userId);
    if (existing) {
      const same = existing.name === person.name &&
        existing.profileImage === person.profileImage &&
        existing.comment === person.comment;
      Object.assign(existing, person);
      // 先頭に move
      const at = this.list.indexOf(existing);
      if (at > 0) {
        this.list.splice(at, 1);
        this.list.unshift(existing);
        return true;
      }
      return !same;
    }

    this.byId.set(person.userId, person);
    this.list.unshift(person);
    while (this.list.length > KEEP) {
      const dropped = this.list.pop();
      this.byId.delete(dropped.userId);
    }
    return true;
  }

  clear() {
    this.list = [];
    this.byId.clear();
    this.onChange();
  }
}

module.exports = { OneCommeClient, DEFAULT_URL, pickComment, extractComments };
