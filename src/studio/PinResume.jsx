// The session lapsed: the page stays, the text stays on this device, the PIN brings the
// writer back (spec §3.5; Jonathan, 2026-11-03: "8 hours with a PIN to get back in").
import React, { useState } from "react";
import { isChildProfile, signInMessage, signInProfile } from "../auth.js";

export default function PinResume({ userId, onResumed, standalone = false }) {
  const [pin, setPin] = useState("");
  const [mine, setMine] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const child = isChildProfile(userId);
  const name = userId ? userId[0].toUpperCase() + userId.slice(1) : "";

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signInProfile({ userId, pin: child ? undefined : pin, personalDevice: child ? undefined : mine });
      onResumed();
    } catch (err) {
      setError(signInMessage(err.code, name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={standalone ? "pin-standalone" : "st-modal-backdrop"} role="presentation">
      <form className="st-modal pin" role="dialog" aria-modal="true" aria-labelledby="pin-title" onSubmit={submit}>
        <h2 id="pin-title">{userId ? `Welcome back, ${name}` : "Sign in to keep writing"}</h2>
        <p className="muted">{standalone ? "Sign in to open the studio." : "You were away for a while. Nothing you wrote is lost: it's kept on this computer and syncs when you're back."}</p>
        {!child && userId && (
          <>
            <label htmlFor="pin-input">PIN</label>
            <input id="pin-input" type="password" inputMode="numeric" autoComplete="current-password" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} />
            <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> This is my own computer: keep me signed in for 8 hours</label>
          </>
        )}
        {!userId && <p>Choose who's writing on the <a href="/">home screen</a> first.</p>}
        {error && <p className="st-error" role="alert">{error}</p>}
        {userId && <button type="submit" className="st-btn primary" disabled={busy || (!child && pin.length < 4)}>{busy ? "Signing in…" : "Keep writing"}</button>}
      </form>
    </div>
  );
}
