import { useEffect, useRef } from "react";
import { getApiBase } from "@/lib/api-base";

const BASE = getApiBase();
function getToken() { return localStorage.getItem("tg_erp_token"); }

/**
 * Auto clock-in/clock-out for portal staff (chefs, deliverymen): fires a
 * clock-in the moment their portal mounts (login), and a best-effort
 * clock-out when they leave — either via explicit logout/unmount (normal
 * fetch) or by closing/refreshing the tab (navigator.sendBeacon, since the
 * browser will not wait for a normal fetch to finish on unload).
 */
export function useAttendance(enabled: boolean, branchId?: number | null) {
  const clockedInRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return;

    fetch(`${BASE}/api/payroll/timesheets/clock-in`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ branchId }),
    }).then(res => { if (res.ok) clockedInRef.current = true; }).catch(() => {});

    const clockOutBeacon = () => {
      if (!clockedInRef.current) return;
      const blob = new Blob([JSON.stringify({ token })], { type: "text/plain" });
      navigator.sendBeacon(`${BASE}/api/payroll/timesheets/clock-out-beacon`, blob);
    };
    window.addEventListener("pagehide", clockOutBeacon);
    window.addEventListener("beforeunload", clockOutBeacon);

    return () => {
      window.removeEventListener("pagehide", clockOutBeacon);
      window.removeEventListener("beforeunload", clockOutBeacon);
      // Portal component unmounting during the same session (e.g. explicit logout,
      // navigating away) — clock out normally rather than relying on the beacon.
      if (clockedInRef.current) {
        fetch(`${BASE}/api/payroll/timesheets/clock-out`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        }).catch(() => {});
        clockedInRef.current = false;
      }
    };
  }, [enabled, branchId]);
}
