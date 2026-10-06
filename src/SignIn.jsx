import React, { useEffect, useRef, useState } from "react";
import {
  ADULT_PROFILES,
  enrollDevice,
  isChildProfile,
  isDeviceEnrolled,
  signInMessage,
  signInProfile,
} from "./auth";

// Signing in as the person who is reading (Otherwise QA O-01, 2026-10-06).
//
//   Keen / Talia on a set-up device  -> signed in at once, no PIN.
//   Keen / Talia on a new device     -> "A grown-up needs to set up this device":
//                                       Jonathan or Adele enters their PIN once.
//   Jonathan / Adele                 -> their PIN, every time they are chosen.
//
// The PIN is sent to the server and nowhere else; it is never stored here.

function nameOf(users, id) {
  return (users || []).find((u) => u.userId === id)?.displayName || id;
}

export function SignInSheet({ who, users, onDone, onCancel }) {
  const child = isChildProfile(who);
  const [step, setStep] = useState(() => (child ? (isDeviceEnrolled() ? "working" : "setup") : "pin"));
  const [grownUp, setGrownUp] = useState(ADULT_PROFILES[0]);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const name = nameOf(users, who);

  async function finishChild() {
    setStep("working");
    try {
      await signInProfile({ userId: who });
      onDone();
    } catch (e) {
      if (e.code === "DEVICE_NOT_ENROLLED" || e.code === "DEVICE_REVOKED") {
        setStep("setup");
        setError(signInMessage(e.code));
      } else {
        setStep("failed");
        setError(signInMessage(e.code, name));
      }
    }
  }

  useEffect(() => {
    if (child && step === "working" && isDeviceEnrolled()) finishChild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === "pin" || step === "setup") inputRef.current?.focus?.();
  }, [step, grownUp]);

  async function submitPin(event) {
    event?.preventDefault?.();
    if (!pin) return;
    const adult = step === "setup" ? grownUp : who;
    const before = step;
    setStep("working");
    setError("");
    try {
      if (isDeviceEnrolled()) {
        await signInProfile({ userId: adult, pin });
      } else {
        await enrollDevice({ userId: adult, pin });
      }
      setPin("");
      if (before === "setup") {
        await finishChild();
        return;
      }
      onDone();
    } catch (e) {
      setPin("");
      setStep(before);
      setError(signInMessage(e.code, nameOf(users, adult)));
    }
  }

  const pinField = (label) => (
    <form className="signin-form" onSubmit={submitPin}>
      <label className="signin-label" htmlFor="otherwise-pin">{label}</label>
      <input
        id="otherwise-pin"
        ref={inputRef}
        className="signin-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={8}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        aria-label={label}
      />
      <button className="gold-button" type="submit" disabled={pin.length < 4}>Continue</button>
    </form>
  );

  return (
    <div className="signin-backdrop" role="dialog" aria-modal="true" aria-label={`Sign in as ${name}`}>
      <div className="signin-sheet">
        {step === "pin" && (
          <>
            <h2>{name}</h2>
            {pinField(`${name}'s PIN`)}
          </>
        )}
        {step === "setup" && (
          <>
            <h2>A grown-up needs to set up this device</h2>
            <p className="signin-note">Once it's set up, {name} can open stories here by tapping their name.</p>
            <div className="signin-grownups" role="radiogroup" aria-label="Grown-up">
              {ADULT_PROFILES.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={grownUp === id}
                  className={`reader-card ${grownUp === id ? "selected" : ""}`}
                  onClick={() => { setGrownUp(id); setPin(""); }}
                >
                  <span className="reader-name">{nameOf(users, id)}</span>
                </button>
              ))}
            </div>
            {pinField(`${nameOf(users, grownUp)}'s PIN`)}
          </>
        )}
        {step === "working" && <p className="signin-note" role="status">Signing in…</p>}
        {step === "failed" && (
          <button className="gold-button" type="button" onClick={finishChild}>Try again</button>
        )}
        {error && <p className="signin-error" role="alert">{error}</p>}
        <button className="inline-button signin-cancel" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
