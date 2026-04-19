'use strict';

const TTL_MS = 3 * 60 * 1000;
const MIN_AGE_MS = 1000;
const pending = new Map();

function setPending(userId, plan) {
  pending.set(userId, { ...plan, createdAt: Date.now() });
}

function getPending(userId) {
  const entry = pending.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    pending.delete(userId);
    return null;
  }
  return entry;
}

function isReadyToApply(entry) {
  return entry && Date.now() - entry.createdAt >= MIN_AGE_MS;
}

function clearPending(userId) {
  pending.delete(userId);
}

module.exports = { setPending, getPending, clearPending, isReadyToApply };
