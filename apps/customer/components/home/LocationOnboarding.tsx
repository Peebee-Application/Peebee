"use client";

import { isUserVerified } from "@peebee/shared";
import { useEffect, useState } from "react";
import { SaveLocationPrompt } from "../SaveLocationPrompt";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const DISMISS_KEY = "peebee-location-prompt-dismissed";

/** Prompts a verified customer with no saved locations yet to save one
 * (Home/Office), shown once per browser on their first real visit —
 * dismissing or saving hides it for good. */
export function LocationOnboarding() {
  const { user, ready } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!ready || !user || !isUserVerified(user)) return;
    if (localStorage.getItem(DISMISS_KEY)) return;
    let cancelled = false;
    api
      .getLocations()
      .then((res) => {
        if (!cancelled && res.locations.length === 0) setShow(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setShow(false);
  }

  if (!show) return null;
  return <SaveLocationPrompt onClose={dismiss} onSaved={dismiss} />;
}
