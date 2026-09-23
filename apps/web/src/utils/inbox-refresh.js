// One request at a time; leaving the inbox suspends scheduling without leaking
// an endless loop. Re-entry during a request schedules one fresh check after it.
export function createInboxCheck({ isActive, isReady, getContext, getMarker, fetchLatest, refresh }) {
  return async () => {
    if (!isActive() || !isReady()) return;
    const context = getContext();
    const marker = getMarker();
    if (marker?.reqAccountId !== context.accountId || marker?.allReceive !== context.allReceive) return;
    const list = await fetchLatest(marker?.emailId || 0, context.accountId, context.allReceive);
    if (!isActive() || JSON.stringify(getContext()) !== JSON.stringify(context)) return;
    if (list?.length) await refresh();
  };
}

export function createInboxRefresh({ check, interval, onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let enabled = false, disposed = false, running = false, timer = null, again = false;
  const clear = () => { if (timer !== null) clearTimer(timer); timer = null; };
  function schedule(delay) {
    clear();
    if (enabled && !disposed) timer = setTimer(run, delay);
  }
  async function run() {
    timer = null;
    if (!enabled || disposed || running) return;
    running = true;
    try { await check(); } catch (error) { onError(error); }
    finally {
      running = false;
      schedule(again ? 0 : interval());
      again = false;
    }
  }
  return {
    resume() {
      if (disposed) return;
      enabled = true;
      if (running) again = true;
      else schedule(0);
    },
    pause() { enabled = false; again = false; clear(); },
    dispose() { disposed = true; enabled = false; again = false; clear(); },
  };
}
