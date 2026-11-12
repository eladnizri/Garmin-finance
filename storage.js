'use strict';

/* =========================================================================
 * storage.js — Backward-compat shim.
 * Real implementations are now in auth.js (Supabase-backed).
 * This file is kept so existing <script> tags and callers still work
 * if auth.js hasn't loaded yet (e.g. offline fallback).
 * ========================================================================= */

// If auth.js already defined these, do nothing.
if (typeof dbGetAll === 'undefined') {
  /* Fallback to empty implementations — app shows login screen anyway */
  async function dbGetAll() { return []; }
  async function dbPutDays() {}
  async function dbClear() {}
  async function dbCount() { return 0; }
}
